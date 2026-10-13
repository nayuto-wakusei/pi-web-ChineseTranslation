import { ChildProcess, spawn, spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { eventScopeFromManagementContext } from "../realtime/sessionEventScope.js";
import { ManagementCommandRunService, managementCommandRunProcess, type ManagementProcessSpawner, type RunTerminalCommandOptions } from "./managementCommandRunService.js";

const services: ManagementCommandRunService[] = [];
afterEach(() => { for (const service of services.splice(0)) service.dispose(); });

function context(id = "first", patch: Partial<ManagementEmbedContext> = {}): ManagementEmbedContext {
  return { user: { id, rootUserId: id, roles: [], permissions: [] }, projects: [{ id: "p1", name: "Project" }], tools: { allow: ["terminal-command-runs"] }, ...patch };
}
function options(managementContext = context(), patch: Partial<RunTerminalCommandOptions> = {}): RunTerminalCommandOptions {
  return { origin: "test", title: "Command", command: "true", projectId: "p1", workspaceId: "w1", cwd: process.cwd(), managementContext, ...patch };
}
function fixture(allowPrivileged = false) {
  const children: ChildProcess[] = [];
  const kills: MockInstance<ChildProcess["kill"]>[] = [];
  const spawner = vi.fn<ManagementProcessSpawner>(() => {
    const child = new ChildProcess();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    kills.push(vi.spyOn(child, "kill").mockReturnValue(true));
    children.push(child);
    return child;
  });
  const events = new SessionEventHub();
  const publish = vi.spyOn(events, "publishRealtime");
  const activity = { updateTerminal: vi.fn(), removeTerminal: vi.fn() };
  const service = new ManagementCommandRunService(events, activity, spawner, allowPrivileged);
  services.push(service);
  return { service, spawner, children, kills, publish, activity };
}

describe("management command runs", () => {
  it("rejects missing management ownership before spawning", () => {
    const { service, spawner } = fixture();
    const runOptions = options();
    delete runOptions.managementContext;
    expect(() => service.runCommand(runOptions)).toThrow("Management context is required");
    expect(spawner).not.toHaveBeenCalled();
  });
  it("keeps explicit tool deny authoritative", () => {
    const { service, spawner } = fixture(true);
    expect(() => service.runCommand(options(context("first", { tools: { allow: ["terminal-command-runs"], deny: ["terminal-command-runs"] }, privileged: { bash: true, network: true } })))).toThrow("disabled");
    expect(spawner).not.toHaveBeenCalled();
  });
  it("runs only a Bubblewrap workspace-isolated command, never an interactive PTY", () => {
    const { service, spawner } = fixture();
    service.runCommand(options());
    expect(spawner.mock.calls[0]?.[0]).toBe("bwrap");
    const args = spawner.mock.calls[0]?.[1];
    expect(args).toEqual(expect.arrayContaining(["--unshare-net", "--bind", process.cwd(), "/workspace", "--chdir"]));
    expect(spawner.mock.calls[0]?.[2]).toMatchObject({ stdio: ["ignore", "pipe", "pipe"], env: { PI_WEB_TERMINAL: "1" } });
  });
  it("keeps network isolated without the machine feature switch", () => {
    expect(managementCommandRunProcess(options(context("first", { privileged: { network: true } })), false).args).toContain("--unshare-net");
  });
  it("allows a signed network grant only with the machine switch", () => {
    expect(managementCommandRunProcess(options(context("first", { privileged: { network: true } })), true).args).not.toContain("--unshare-net");
  });
  it("closes only the matching management scope at the same cwd", () => {
    const { service, kills } = fixture();
    const first = service.runCommand(options(context("first")));
    const second = service.runCommand(options(context("second")));
    service.closeForCwd(process.cwd(), context("first"));
    expect(service.get(first.terminalId)).toBeUndefined();
    expect(service.get(second.terminalId)).toBeDefined();
    expect(kills[0]).toHaveBeenCalledWith("SIGTERM");
    expect(kills[1]).not.toHaveBeenCalled();
    expect(() => { service.closeForCwd(process.cwd()); }).toThrow("Management context is required");
  });
  it("isolates list, get and cancellation by owner", () => {
    const { service, kills } = fixture();
    const run = service.runCommand(options());
    expect(service.listCommandRuns({}, context("second"))).toEqual([]);
    expect(service.getCommandRun(run.id, context("second"))).toBeUndefined();
    expect(() => service.cancelCommandRun(run.id, context("second"))).toThrow("not found");
    expect(kills[0]).not.toHaveBeenCalled();
  });
  it("tracks metadata filters and returns detached snapshots", () => {
    const { service } = fixture();
    const run = service.runCommand(options(context(), { metadata: { operation: "test" } }));
    run.metadata["operation"] = "changed";
    expect(service.listCommandRuns({ metadata: { operation: "test" }, projectId: "p1", workspaceId: "w1", statuses: ["running"] }, context())).toHaveLength(1);
    expect(service.listCommandRuns({ metadata: { operation: "changed" } }, context())).toEqual([]);
  });
  it("publishes lifecycle and activity only in the management scope", () => {
    const { service, children, publish, activity } = fixture();
    const run = service.runCommand(options());
    expect(publish.mock.calls[0]).toEqual([{ type: "terminal.created", terminal: service.get(run.terminalId) }, eventScopeFromManagementContext(context())]);
    children[0]?.emit("close", 0);
    expect(service.getCommandRun(run.id, context())).toMatchObject({ status: "succeeded", exitCode: 0 });
    expect(activity.updateTerminal).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[0]).toMatchObject({ type: "terminal.exited", terminal: { exited: true } });
    service.close(run.terminalId);
    expect(activity.removeTerminal).toHaveBeenCalledWith(run.terminalId, process.cwd(), eventScopeFromManagementContext(context()));
    expect(publish.mock.calls[2]?.[0]).toEqual({ type: "terminal.closed", terminalId: run.terminalId, cwd: process.cwd() });
  });
  it("captures stdout and stderr and replays bounded output", () => {
    const { service, children } = fixture();
    const run = service.runCommand(options());
    children[0]?.stdout?.emit("data", Buffer.from("a".repeat(200010)));
    children[0]?.stderr?.emit("data", Buffer.from("stderr"));
    const output = vi.fn();
    service.attach(run.terminalId, { output, exit: vi.fn() });
    expect(output).toHaveBeenCalledWith("a".repeat(199994) + "stderr", true);
  });

  it("preserves split UTF-8 output independently for stdout and stderr", () => {
    const { service, children } = fixture();
    const run = service.runCommand(options(context()));
    const encoded = Buffer.from("中文");
    children[0]?.stdout?.emit("data", encoded.subarray(0, 2));
    children[0]?.stderr?.emit("data", Buffer.from("error"));
    children[0]?.stdout?.emit("data", encoded.subarray(2));
    const output = vi.fn();
    service.attach(run.terminalId, { output, exit: vi.fn() });
    expect(output).toHaveBeenCalledWith("error中文", true);
  });
  it("marks nonzero exits as failed and delivers the exit once", () => {
    const { service, children } = fixture();
    const run = service.runCommand(options());
    const exit = vi.fn();
    service.attach(run.terminalId, { output: vi.fn(), exit });
    children[0]?.emit("close", 7);
    children[0]?.emit("close", 7);
    expect(service.getCommandRun(run.id, context())).toMatchObject({ status: "failed", exitCode: 7 });
    expect(exit).toHaveBeenCalledOnce();
  });
  it("marks asynchronous process failures without orphaning active activity", () => {
    const { service, children, activity } = fixture();
    const run = service.runCommand(options());
    children[0]?.emit("error", new Error("spawn failed"));
    children[0]?.emit("close", null);
    expect(service.getCommandRun(run.id, context())).toMatchObject({ status: "failed" });
    expect(activity.updateTerminal).toHaveBeenCalledTimes(2);
  });
  it("rolls back synchronous startup errors", () => {
    const { service, spawner } = fixture();
    spawner.mockImplementationOnce(() => { throw new Error("spawn failed"); });
    expect(() => service.runCommand(options())).toThrow("spawn failed");
    expect(service.listCommandRuns({}, context())).toEqual([]);
    expect(service.list(process.cwd())).toEqual([]);
  });
  it("cancels active runs without interrupting completed runs", () => {
    const { service, children, kills } = fixture();
    const run = service.runCommand(options());
    service.cancelCommandRun(run.id, context());
    expect(kills[0]).toHaveBeenCalledWith("SIGINT");
    children[0]?.emit("close", 0);
    service.cancelCommandRun(run.id, context());
    expect(kills[0]).toHaveBeenCalledOnce();
    expect(service.getCommandRun(run.id, context())).toMatchObject({ status: "failed", exitCode: 0 });
  });
  it("disposes all processes without late activity resurrection", () => {
    const { service, children, activity } = fixture();
    service.runCommand(options());
    service.dispose();
    children[0]?.emit("close", 0);
    expect(service.list(process.cwd())).toEqual([]);
    expect(activity.updateTerminal).toHaveBeenCalledOnce();
    expect(activity.removeTerminal).toHaveBeenCalledOnce();
  });
  it("detaches output observers", () => {
    const { service, children } = fixture();
    const run = service.runCommand(options());
    const output = vi.fn();
    const detach = service.attach(run.terminalId, { output, exit: vi.fn() });
    detach();
    children[0]?.stdout?.emit("data", Buffer.from("late"));
    expect(output).not.toHaveBeenCalled();
  });
  it("rejects invalid metadata before spawning", () => {
    const { service, spawner } = fixture();
    expect(() => service.runCommand(options(context(), { metadata: { invalid: 3 } }))).toThrow("metadata values must be strings");
    expect(spawner).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform === "win32" || spawnSync("bwrap", ["--version"]).status !== 0)("cancels a real isolated Linux command and reaps its process", async () => {
    let child: ChildProcess | undefined;
    const service = new ManagementCommandRunService(undefined, undefined, (command, args, options) => {
      child = spawn(command, args, options);
      return child;
    });
    services.push(service);
    const run = service.runCommand(options(context(), { command: "printf 'ready\\n'; sleep 60" }));
    let finish!: () => void;
    const ended = new Promise<void>((resolve) => { finish = resolve; });
    const ready = new Promise<void>((resolve, reject) => {
      let output = "";
      let started = false;
      service.attach(run.terminalId, {
        output: (data) => { output += data; if (output.endsWith("ready\n")) { started = true; resolve(); } },
        exit: () => { finish(); if (!started) reject(new Error(`Isolated command exited before readiness: ${output}`)); },
      });
    });
    await ready;
    service.cancelCommandRun(run.id, context());
    await ended;
    const pid = child?.pid;
    expect(pid).toBeTypeOf("number");
    if (pid === undefined) throw new Error("Expected a real command process");
    expect(() => process.kill(pid, 0)).toThrow();
    expect(service.getCommandRun(run.id, context())?.status).toBe("failed");
    service.closeForCwd(process.cwd(), context());
    expect(service.list(process.cwd())).toEqual([]);
  });
});

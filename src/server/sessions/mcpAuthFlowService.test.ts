import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { McpAuthFlowService } from "./mcpAuthFlowService.js";
import { createTranslator, UserFacingError } from "../../shared/i18n.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const services: McpAuthFlowService[] = [];
function service(options?: ConstructorParameters<typeof McpAuthFlowService>[0]) {
  const result = new McpAuthFlowService(options);
  services.push(result);
  return result;
}
afterEach(() => { for (const item of services.splice(0)) item.dispose(); vi.useRealTimers(); });

const OWNER = { scope: "normal", sessionId: "session", cwd: resolve("/workspace"), projectPath: resolve("/project") };

function operation(run: () => Promise<void>, identity = {}) {
  return { owner: OWNER, identity, isCurrent: () => true, run };
}

describe("MCP auth operation transport", () => {
  it("clears terminal expiry timers on disposal without waiting for retention TTL", async () => {
    vi.useFakeTimers();
    const flows = service();
    const flow = flows.start(operation(() => Promise.resolve()));
    await Promise.resolve();
    expect(flows.get(flow.flowId, OWNER).status).toBe("complete");
    expect(vi.getTimerCount()).toBe(1);
    flows.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("translates only local labels and errors while preserving SDK content and protocol values", async () => {
    const flows = service({ translator: createTranslator("test", {
      "mcpAuth.server": "Local server label", "mcpAuth.chooseServer": "Local choose label",
      "mcpAuth.yes": "Local yes", "mcpAuth.no": "Local no", "mcpAuth.invalidResponse": "Local response error",
    }) });
    const flow = flows.start(operation(async () => {
      const ui = required(McpAuthFlowService.current());
      expect(await ui.selectServer([{ name: "alpha", description: "SDK server description" }])).toBe("alpha");
      expect(await ui.confirm("SDK title", "SDK confirmation")).toBe(true);
      expect(await ui.input("SDK redirect title", "SDK placeholder")).toBe("original redirect");
      ui.notify("SDK signed in notice");
      throw new UserFacingError("mcpAuth.invalidResponse", "Invalid MCP authentication response");
    }));
    expect(flow.providerName).toBe("Local server label");
    expect(flow.select).toMatchObject({ message: "Local choose label", options: [{ value: "alpha", label: "alpha", description: "SDK server description" }] });
    flows.respond(flow.flowId, required(flow.select).requestId, "alpha", OWNER);
    await vi.waitFor(() => { expect(flows.get(flow.flowId, OWNER).select?.message).toBe("SDK title\nSDK confirmation"); });
    const confirm = required(flows.get(flow.flowId, OWNER).select);
    expect(confirm.options).toEqual([{ value: "Yes", label: "Local yes" }, { value: "No", label: "Local no" }]);
    flows.respond(flow.flowId, confirm.requestId, "Yes", OWNER);
    await vi.waitFor(() => { expect(flows.get(flow.flowId, OWNER).prompt?.message).toBe("SDK redirect title"); });
    const prompt = required(flows.get(flow.flowId, OWNER).prompt);
    expect(prompt.placeholder).toBe("SDK placeholder");
    flows.respond(flow.flowId, prompt.requestId, "original redirect", OWNER);
    await vi.waitFor(() => { expect(flows.get(flow.flowId, OWNER)).toMatchObject({ status: "error", error: "Local response error", progress: ["SDK signed in notice"] }); });
  });

  it("routes selection/input, validates responses, dedupes literal URLs and preserves final notices", async () => {
    const flows = service();
    const flow = flows.start(operation(async () => {
      const ui = required(McpAuthFlowService.current());
      expect(await ui.select("Server", ["alpha", "beta"])).toBe("beta");
      ui.notify("Open https://example.test/authorize?q=1");
      ui.openUrl("https://example.test/authorize?q=1");
      expect(await ui.input("Redirect", "https://localhost/callback")).toBe("redirect");
      ui.notify("Signed in, but reconnect failed");
    }));
    expect(flow.select).toBeDefined();
    expect(() => flows.respond(flow.flowId, required(flow.select).requestId, "unknown", OWNER)).toThrow("Invalid");
    expect(() => flows.respond(flow.flowId, "stale", "alpha", OWNER)).toThrow("no longer pending");
    flows.respond(flow.flowId, required(flow.select).requestId, "beta", OWNER);
    await vi.waitFor(() => { expect(flows.get(flow.flowId, OWNER).prompt).toBeDefined(); });
    const current = flows.get(flow.flowId, OWNER);
    expect(current.auth?.url).toBe("https://example.test/authorize?q=1");
    expect(current.progress).toEqual([]);
    flows.respond(flow.flowId, required(current.prompt).requestId, "redirect", OWNER);
    await vi.waitFor(() => { expect(flows.get(flow.flowId, OWNER).status).toBe("complete"); });
    expect(flows.get(flow.flowId, OWNER).progress).toEqual(["Signed in, but reconnect failed"]);
  });

  it("signal cleanup dismisses only the input when the browser callback wins", async () => {
    const flows = service();
    const controller = new AbortController();
    const reconnect = deferred();
    const flow = flows.start(operation(async () => {
      expect(await required(McpAuthFlowService.current()).input("Redirect", undefined, { signal: controller.signal })).toBeUndefined();
      await reconnect.promise;
      required(McpAuthFlowService.current()).notify("Pi final message");
    }));
    controller.abort();
    expect(flows.get(flow.flowId, OWNER)).toMatchObject({ status: "running" });
    expect(flows.get(flow.flowId, OWNER).cancelRequested).toBeUndefined();
    expect(flows.get(flow.flowId, OWNER).prompt).toBeUndefined();
    reconnect.resolve();
    await vi.waitFor(() => { expect(flows.get(flow.flowId, OWNER).status).toBe("complete"); });
  });

  it.each(["select", "input"] as const)("cancel settles %s undefined, rejects future prompts and keeps running through reconnect", async (kind) => {
    const flows = service();
    const reconnect = deferred();
    const flow = flows.start(operation(async () => {
      const ui = required(McpAuthFlowService.current());
      const result = kind === "select" ? await ui.select("Server", ["a"]) : await ui.input("Redirect");
      expect(result).toBeUndefined();
      expect(await ui.input("Late redirect")).toBeUndefined();
      expect(await ui.select("Late selection", ["b"])).toBeUndefined();
      expect(await ui.confirm("Late confirmation", "Continue?")).toBe(false);
      await reconnect.promise;
      ui.notify("Credentials may already have been saved");
    }));
    expect(flows.cancel(flow.flowId, OWNER)).toMatchObject({ status: "running", cancelRequested: true });
    expect(() => flows.start(operation(() => Promise.resolve()))).toThrow("already running");
    reconnect.resolve();
    await vi.waitFor(() => { expect(flows.get(flow.flowId, OWNER).status).toBe("complete"); });
    expect(flows.get(flow.flowId, OWNER)).toMatchObject({ cancelRequested: true, progress: ["Credentials may already have been saved"] });
  });

  it("serializes scoped operations across sessions sharing Pi credentials until the real command ends", async () => {
    const flows = service();
    const command = deferred();
    const first = flows.start(operation(() => command.promise));
    const other = { ...operation(() => Promise.resolve()), owner: { ...OWNER, sessionId: "other-session" } };
    expect(() => flows.start(other)).toThrow("running on this machine");
    flows.cancel(first.flowId, OWNER);
    expect(() => flows.start(other)).toThrow("running on this machine");
    command.resolve();
    await vi.waitFor(() => { expect(flows.get(first.flowId, OWNER).status).toBe("complete"); });
    expect(flows.start(other).target).toBe("mcp");
  });

  it("cancel before discovery completes prevents the first prompt", async () => {
    const flows = service();
    const discovery = deferred();
    const flow = flows.start(operation(async () => {
      await discovery.promise;
      expect(await required(McpAuthFlowService.current()).input("Redirect")).toBeUndefined();
    }));
    flows.cancel(flow.flowId, OWNER);
    discovery.resolve();
    await vi.waitFor(() => { expect(flows.get(flow.flowId, OWNER).status).toBe("complete"); });
    expect(flows.get(flow.flowId, OWNER).prompt).toBeUndefined();
  });

  it("guards runtime identity and retires stale async ancestry in finally", async () => {
    const flows = service();
    const later = deferred();
    const identity = {};
    let current = true;
    let stale: Promise<void> | undefined;
    const flow = flows.start({ ...operation(() => {
      expect(McpAuthFlowService.current({})).toBeUndefined();
      expect(McpAuthFlowService.current(identity)).toBeDefined();
      current = false;
      expect(required(McpAuthFlowService.current(identity)).isCancelled()).toBe(true);
      current = true;
      stale = later.promise.then(() => { expect(McpAuthFlowService.current(identity)).toBeUndefined(); });
      return Promise.resolve();
    }, identity), isCurrent: () => current });
    await vi.waitFor(() => { expect(flows.get(flow.flowId, OWNER).status).toBe("complete"); });
    later.resolve();
    await stale;
    expect(McpAuthFlowService.current()).toBeUndefined();
  });

  it("captures emitted command errors even when SDK resolves; does not classify notices", async () => {
    const flows = service();
    const flow = flows.start(operation(() => { required(McpAuthFlowService.current()).error("command failed"); return Promise.resolve(); }));
    await vi.waitFor(() => { expect(flows.get(flow.flowId, OWNER).status).toBe("error"); });
    expect(flows.get(flow.flowId, OWNER).error).toBe("command failed");
    const notice = flows.start(operation(() => { required(McpAuthFlowService.current()).notify("Sign-in failed: invalid state"); return Promise.resolve(); }));
    await vi.waitFor(() => { expect(flows.get(notice.flowId, OWNER).status).toBe("complete"); });
  });

  it("bounds progress, TTL cancels waits without claiming completion, and evicts terminal flows", async () => {
    vi.useFakeTimers();
    const flows = service({ runningTtlMs: 10, terminalTtlMs: 20 });
    const flow = flows.start(operation(async () => {
      const ui = required(McpAuthFlowService.current());
      for (let i = 0; i < 150; i++) ui.notify(String(i));
      await ui.input("Redirect");
    }));
    expect(flow.progress).toHaveLength(100);
    await vi.advanceTimersByTimeAsync(10);
    expect(flows.get(flow.flowId, OWNER)).toMatchObject({ status: "complete", cancelRequested: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(() => flows.get(flow.flowId, OWNER)).toThrow("not found");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the machine lock after running TTL until the real SDK command ends", async () => {
    vi.useFakeTimers();
    const flows = service({ runningTtlMs: 10 });
    const command = deferred();
    const flow = flows.start(operation(() => command.promise));
    await vi.advanceTimersByTimeAsync(10);
    expect(flows.get(flow.flowId, OWNER)).toMatchObject({ status: "running", cancelRequested: true });
    expect(() => flows.start({ ...operation(() => Promise.resolve()), owner: { ...OWNER, scope: "management:other" } })).toThrow("running on this machine");
    await expect(flows.discover({ ...operation(() => Promise.resolve()), owner: { ...OWNER, sessionId: "other" } })).rejects.toThrow("running on this machine");
    command.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(flows.get(flow.flowId, OWNER).status).toBe("complete");
  });

  it("disposal settles waits, retains the private sink, clears timers and refuses starts", async () => {
    vi.useFakeTimers();
    const flows = service();
    const finished = deferred();
    flows.start(operation(async () => {
      expect(await required(McpAuthFlowService.current()).input("Redirect", undefined, { timeout: 500 })).toBeUndefined();
      expect(required(McpAuthFlowService.current()).isCancelled()).toBe(true);
      finished.resolve();
    }));
    flows.dispose();
    await finished.promise;
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => flows.start(operation(() => Promise.resolve()))).toThrow("disposed");
  });

  it.each(["runtime-close", "dispose"] as const)("absorbs late OAuth UI until the actual command ends after %s", async (mode) => {
    const flows = service();
    const late = deferred();
    const finished = deferred();
    const ordinary: string[] = [];
    const identity = {};
    let current = true;
    const flow = flows.start({ ...operation(async () => {
      const captured = required(McpAuthFlowService.current(identity));
      await captured.input("Redirect");
      await late.promise;
      captured.notify("late captured code=private");
      const ui = McpAuthFlowService.current(identity);
      if (ui) {
        ui.notify("late code=private");
        ui.openUrl("https://example.test/authorize?secret=private");
        ui.error("late private error");
        expect(await ui.input("late redirect")).toBeUndefined();
        expect(await ui.select("late selection", ["secret"])).toBeUndefined();
        expect(ui.isCancelled()).toBe(true);
      } else ordinary.push("private OAuth callback escaped");
      finished.resolve();
    }, identity), isCurrent: () => current });
    current = false;
    if (mode === "dispose") flows.dispose();
    else flows.cancelSession(OWNER);
    expect(() => { flows.assertSessionAvailable(OWNER); }).toThrow("running for this session");
    late.resolve();
    await finished.promise;
    await vi.waitFor(() => { expect(() => { flows.assertSessionAvailable(OWNER); }).not.toThrow(); });
    expect(ordinary).toEqual([]);
    if (mode === "runtime-close") expect(flows.get(flow.flowId, OWNER)).toMatchObject({ status: "complete", cancelRequested: true, progress: [] });
    expect(McpAuthFlowService.current(identity)).toBeUndefined();
  });

  it("retains the private sink for active discovery during disposal", async () => {
    const flows = service();
    const late = deferred();
    const discovery = flows.discover({ ...operation(async () => {
      await late.promise;
      const ui = required(McpAuthFlowService.current());
      expect(ui.isCancelled()).toBe(true);
      ui.notify("late private discovery status");
      ui.openUrl("https://example.test/private-discovery");
      expect(await ui.input("late redirect")).toBeUndefined();
    }) });
    flows.dispose();
    await expect(flows.discover(operation(() => Promise.resolve()))).rejects.toThrow("disposed");
    late.resolve();
    await discovery;
    expect(McpAuthFlowService.current()).toBeUndefined();
  });

  it.each([
    { scope: "management:user-a" },
    { sessionId: "different-session" },
    { cwd: resolve("/other-workspace") },
    { projectPath: resolve("/other-project") },
  ])("rejects reading, responding and cancelling another owner: %j", (difference) => {
    const flows = service();
    const flow = flows.start(operation(async () => { await required(McpAuthFlowService.current()).input("Redirect"); }));
    const wrongOwner = { ...OWNER, ...difference };
    expect(() => flows.get(flow.flowId, wrongOwner)).toThrow("not found");
    expect(() => flows.respond(flow.flowId, required(flow.prompt).requestId, "redirect", wrongOwner)).toThrow("not found");
    expect(() => flows.cancel(flow.flowId, wrongOwner)).toThrow("not found");
    flows.cancelSession(wrongOwner);
    expect(flows.get(flow.flowId, OWNER).cancelRequested).toBeUndefined();
    expect(() => { flows.assertSessionAvailable(wrongOwner); }).not.toThrow();
    expect(() => { flows.assertSessionAvailable(OWNER); }).toThrow("running for this session");
  });

  it("returns a cloned owner only inside its captured scope and normalizes paths", () => {
    const flows = service();
    const flow = flows.start(operation(async () => { await required(McpAuthFlowService.current()).input("Redirect"); }));
    expect(() => flows.owner(flow.flowId, "management:another-identity")).toThrow("not found");
    const owner = flows.owner(flow.flowId, OWNER.scope);
    owner.cwd = resolve("/other");
    expect(flows.owner(flow.flowId, OWNER.scope)).toEqual(OWNER);
    const equivalent = { ...OWNER, cwd: resolve(OWNER.cwd, "child", ".."), projectPath: resolve(OWNER.projectPath, "child", "..") };
    expect(flows.get(flow.flowId, equivalent).flowId).toBe(flow.flowId);
    flows.cancelSession(equivalent);
    expect(flows.get(flow.flowId, OWNER).cancelRequested).toBe(true);
  });

  it("does not permit nested discovery to borrow another identity or owner", async () => {
    const flows = service();
    const identity = {};
    const flow = flows.start(operation(async () => {
      const discover = { owner: OWNER, identity, isCurrent: () => true, run: () => Promise.resolve("servers") };
      expect(() => { flows.assertSessionAvailable(OWNER); }).not.toThrow();
      await expect(flows.discover({ ...discover, identity: {} })).rejects.toThrow("no longer current");
      await expect(flows.discover({ ...discover, owner: { ...OWNER, scope: "management:other" } })).rejects.toThrow("no longer current");
      expect(await flows.discover(discover)).toBe("servers");
    }, identity));
    await vi.waitFor(() => { expect(flows.get(flow.flowId, OWNER).status).toBe("complete"); });
  });

  it("suppresses discovery URLs and notices and rejects unexpected interactive discovery", async () => {
    const flows = service();
    await expect(flows.discover({
      owner: OWNER, identity: {}, isCurrent: () => true,
      run: async () => {
        const ui = required(McpAuthFlowService.current());
        ui.notify("private discovery status");
        ui.openUrl("https://example.test/authorize?secret=discovery");
        await expect(ui.input("Unexpected redirect")).rejects.toThrow("cannot request input");
      },
    })).rejects.toThrow("discovery failed");
    expect(McpAuthFlowService.current()).toBeUndefined();
    const flow = flows.start(operation(() => Promise.resolve()));
    expect(flow.progress).toEqual([]);
    expect(flow.auth).toBeUndefined();
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value");
  return value;
}

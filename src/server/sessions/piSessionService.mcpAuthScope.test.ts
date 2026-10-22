import { afterEach, expect, it, vi } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { createTranslator } from "../../shared/i18n.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, sessionGateway, sessionRecord, sessionRef, testManagementContext, testModelRuntime } from "./piSessionService.testSupport.js";

const services: PiSessionService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.dispose())); });

async function fixture() {
  const id = "same-id";
  const first = { ...testManagementContext(), privileged: { bash: true, network: true } };
  const second = { ...first, user: { ...first.user, id: "second-account" } };
  const contexts = [undefined, first, second];
  const runtimes = contexts.map((context) => {
    const fake = fakeRuntime(id, { sessionFile: `/sessions/${context?.user.id ?? "normal"}.jsonl` });
    fake.session.settingsManager.isProjectTrusted = () => true;
    fake.session.extensionRunner.getRegisteredCommands = () => [{ invocationName: "mcp", sourceInfo: { path: "builtin:mcp" }, getArgumentCompletions: () => [{ value: "login isolated", label: "isolated" }] }];
    return fake;
  });
  const createRuntime = vi.fn((_factory, options: { managementContext?: ManagementEmbedContext }) => {
    const index = contexts.findIndex((context) => context?.user.id === options.managementContext?.user.id);
    const runtime = runtimes[index]?.runtime;
    if (runtime === undefined) throw new Error("Unknown fixture identity");
    return Promise.resolve(runtime);
  });
  let projectPath: string | undefined = "/project";
  let providerAllowed = true;
  const normalProvider = vi.fn(() => providerAllowed ? Promise.resolve(testModelRuntime) : Promise.reject(new Error("project provider authorization removed")));
  const events = new CapturingSessionEventHub();
  const service = new PiSessionService(events, {
    agentDir: "/tmp/mcp-scope", modelRuntime: testModelRuntime, managementModelRuntime: testModelRuntime,
    normalModelRuntimeForCwd: normalProvider,
    managementAllowPrivileged: true, translator: createTranslator("en", {}),
    sessionManager: sessionGateway([sessionRecord(id)]), archiveStore: emptyArchiveStore(),
    projectPathForCwd: () => Promise.resolve(projectPath), createAgentRuntime: createRuntime, heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  for (const context of contexts) await service.status(sessionRef(id), context);
  return { service, first, second, runtimes, events, id, createRuntime, setProject: (path: string | undefined) => { projectPath = path; }, revokeProvider: () => { providerAllowed = false; } };
}

it("isolates flow polling, responses, cancellation and stop for normal and two management identities sharing a session id and cwd", async () => {
  const { service, first, second, id, createRuntime } = await fixture();
  const flow = await service.startMcpAuth(sessionRef(id), "login", undefined, first);
  const before = createRuntime.mock.calls.length;
  const requestId = required(flow.select).requestId;
  for (const context of [undefined, second]) {
    await expect(service.mcpAuthFlow(flow.flowId, context)).rejects.toThrow("flow not found");
    await expect(service.respondToMcpAuthFlow(flow.flowId, requestId, "isolated", context)).rejects.toThrow("flow not found");
    await expect(service.cancelMcpAuthFlow(flow.flowId, context)).rejects.toThrow("flow not found");
  }
  await service.abort(sessionRef(id));
  await service.abort(sessionRef(id), second);
  expect(await service.mcpAuthFlow(flow.flowId, first)).toMatchObject({ status: "running", select: { requestId } });
  expect(createRuntime).toHaveBeenCalledTimes(before);
  await service.respondToMcpAuthFlow(flow.flowId, requestId, "isolated", first);
  await vi.waitFor(async () => { expect((await service.mcpAuthFlow(flow.flowId, first)).status).toBe("complete"); });
});

it("rejects restricted management without constructing a runtime or reusing full-privilege flow access", async () => {
  const { service, first, id, createRuntime } = await fixture();
  const restricted = { ...first, privileged: { bash: false, network: false } };
  const before = createRuntime.mock.calls.length;
  await expect(service.mcpAuthServers(sessionRef(id), restricted)).rejects.toThrow("restricted management");
  await expect(service.startMcpAuth(sessionRef(id), "login", undefined, restricted)).rejects.toThrow("restricted management");
  const flow = await service.startMcpAuth(sessionRef(id), "login", undefined, first);
  await expect(service.mcpAuthFlow(flow.flowId, restricted)).rejects.toThrow("flow not found");
  expect(createRuntime).toHaveBeenCalledTimes(before);
});

it("revalidates the captured project and independent normal provider authorization on every flow access without opening a runtime", async () => {
  const { service, id, createRuntime, setProject, revokeProvider } = await fixture();
  const flow = await service.startMcpAuth(sessionRef(id), "login");
  const before = createRuntime.mock.calls.length;
  setProject("/different-project");
  await expect(service.mcpAuthFlow(flow.flowId)).rejects.toThrow("flow not found");
  await expect(service.respondToMcpAuthFlow(flow.flowId, required(flow.select).requestId, "isolated")).rejects.toThrow("flow not found");
  await expect(service.cancelMcpAuthFlow(flow.flowId)).rejects.toThrow("flow not found");
  setProject("/project");
  revokeProvider();
  await expect(service.mcpAuthFlow(flow.flowId)).rejects.toThrow("provider authorization removed");
  expect(createRuntime).toHaveBeenCalledTimes(before);
});

it("rechecks project ownership after SDK readiness awaits before forwarding any login command", async () => {
  const { service, id, runtimes, setProject } = await fixture();
  const fake = required(runtimes[0]);
  let ready!: () => void;
  fake.session.prompt = () => new Promise<void>((resolve) => { ready = resolve; });
  const login = service.startMcpAuth(sessionRef(id), "login", "isolated");
  await vi.waitFor(() => { expect(ready).toBeDefined(); });
  setProject(undefined);
  ready();
  await expect(login).rejects.toThrow("flow not found");
  expect(fake.calls.prompt).toEqual([]);
});

it.each(["trust revoked", "runtime closed"])("does not leak late SDK auth UI into chat when %s while the real command is still pending", async (change) => {
  const { service, id, runtimes, events } = await fixture();
  const fake = required(runtimes[0]);
  const ui = required(required(fake.calls.bindExtensions.at(-1)).uiContext);
  let resume!: () => void;
  let finish!: () => void;
  let input: string | undefined = "not-yet-settled";
  fake.session.prompt = async (text) => {
    if (text === "/mcp") return;
    await new Promise<void>((resolve) => { resume = resolve; });
    ui.notify("PRIVATE_AUTH_CALLBACK_SENTINEL", "error");
    input = await ui.input("PRIVATE_AUTH_REDIRECT_SENTINEL");
    await new Promise<void>((resolve) => { finish = resolve; });
  };
  const flow = await service.startMcpAuth(sessionRef(id), "login", "isolated");
  await vi.waitFor(() => { expect(resume).toBeDefined(); });
  if (change === "trust revoked") fake.session.settingsManager.isProjectTrusted = () => false;
  else await service.stop(sessionRef(id));
  resume();
  await vi.waitFor(() => { expect(finish).toBeDefined(); });
  expect(input).toBeUndefined();
  expect(JSON.stringify(events.sessionEvents)).not.toContain("PRIVATE_AUTH_");
  if (change === "trust revoked") expect(JSON.stringify(service.notificationInbox(sessionRef(id)))).not.toContain("PRIVATE_AUTH_");
  else expect(() => service.notificationInbox(sessionRef(id))).toThrow("Session not found");
  expect(await service.mcpAuthFlow(flow.flowId)).toMatchObject({ status: "running", cancelRequested: true });
  finish();
  await vi.waitFor(async () => { expect((await service.mcpAuthFlow(flow.flowId)).status).toBe("complete"); });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}

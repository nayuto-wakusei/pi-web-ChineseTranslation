import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ApiScope, type OAuthFlowState, type SessionInfo, type SessionStatus } from "../api";
import { initialAppState, type AppState } from "../appState";
import { AuthController } from "./authController";

const session: SessionInfo = { id: "session-a", cwd: "/repo", path: "/repo/a.jsonl", created: "now", modified: "now", firstMessage: "", messageCount: 0 };
const machine = { id: "remote-a", name: "Remote", kind: "remote" as const, createdAt: "now", updatedAt: "now" };
const controllers: AuthController[] = [];
let poll: (() => void) | undefined;

beforeEach(() => {
  poll = undefined;
  vi.stubGlobal("window", { setInterval: (callback: () => void) => { poll = callback; return 1; }, clearInterval: () => undefined });
});
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.unstubAllGlobals();
});

function flow(patch: Partial<OAuthFlowState> = {}): OAuthFlowState {
  return { flowId: "mcp-flow", target: "mcp", providerId: "mcp", providerName: "MCP server", status: "running", progress: [], ...patch };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}
function fixture(overrides: Partial<typeof api>, patch: Partial<AppState> = {}, scope: ApiScope = "normal") {
  let state = { ...initialAppState(), selectedMachine: machine, selectedSession: session, ...patch };
  const applyStatus = vi.fn();
  const controller = new AuthController(() => state, (update) => { state = { ...state, ...update }; }, applyStatus, {
    scope,
    api: { ...api, status: () => Promise.resolve({ sessionId: session.id, isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }), ...overrides },
  });
  controllers.push(controller);
  return { controller, applyStatus, state: () => state, setState: (update: Partial<AppState>) => { state = { ...state, ...update }; } };
}
async function tick() { poll?.(); await Promise.resolve(); await Promise.resolve(); }

describe("unified MCP auth controller", () => {
  it("does not carry the prior MCP session context into a direct provider login", async () => {
    const provider = { id: "provider-a", name: "Provider A", authType: "oauth" as const, status: { configured: false } };
    const { controller, state } = fixture({
      startMcpAuth: () => Promise.resolve(flow({ status: "complete" })),
      authProviders: () => Promise.resolve({ providers: [provider] }),
      startOAuthLogin: () => Promise.resolve({ flowId: "provider-flow", providerId: provider.id, providerName: provider.name, status: "running", progress: [] }),
    }, { selectedProject: { id: "project-a", name: "Project A", path: "/repo", createdAt: "now" } });
    await controller.openMcpAuth("login");
    await controller.openLogin(provider.id);
    expect(state().authDialog).toMatchObject({ step: "oauth", target: { projectId: "project-a" }, flow: { flowId: "provider-flow" } });
    expect(state().authDialog).not.toHaveProperty("mcpSession");
  });

  it.each(["normal", "management"] as const)("keeps provider authentication scoped separately from MCP in %s mode", async (scope) => {
    const provider = { id: "provider-a", name: "Provider A", authType: "oauth" as const, status: { configured: false } };
    const providerFlow: OAuthFlowState = { flowId: "provider-flow", providerId: provider.id, providerName: provider.name, status: "running", progress: [], prompt: { requestId: "provider-request", message: "Code", promptType: "manual_code" } };
    const start = vi.fn().mockResolvedValue(providerFlow);
    const respond = vi.fn().mockResolvedValue(providerFlow);
    const read = vi.fn().mockResolvedValue(providerFlow);
    const cancel = vi.fn().mockResolvedValue({ ...providerFlow, status: "cancelled" });
    const mcp = vi.fn();
    const project = { id: "project-a", name: "Project A", path: "/repo", createdAt: "now" };
    const { controller, state } = fixture({ authProviders: () => Promise.resolve({ providers: [provider] }), startOAuthLogin: start, respondOAuthFlow: respond, oauthFlow: read, cancelOAuthFlow: cancel, startMcpAuth: mcp, respondMcpAuthFlow: mcp, mcpAuthFlow: mcp, cancelMcpAuthFlow: mcp }, { selectedProject: project }, scope);
    await controller.openLogin(provider.id);
    const target = { machineId: machine.id, machineKind: "remote", ...(scope === "normal" ? { projectId: project.id, projectName: project.name } : {}) };
    expect(start).toHaveBeenCalledExactlyOnceWith(provider.id, target);
    expect(state().authDialog).toMatchObject({ target });
    await controller.respondOAuth("provider-code");
    expect(respond).toHaveBeenCalledExactlyOnceWith(providerFlow.flowId, "provider-request", "provider-code", target);
    await tick();
    expect(read).toHaveBeenCalledWith(providerFlow.flowId, target);
    await controller.cancelOAuth();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(providerFlow.flowId, target);
    expect(mcp).not.toHaveBeenCalled();
  });

  it.each(["normal", "management"] as const)("refreshes only the original MCP session in %s mode", async (scope) => {
    const returnedStatus: SessionStatus = { sessionId: session.id, isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    for (const changed of ["none", "machine", "session", "cwd"] as const) {
      const pending = deferred<SessionStatus>();
      const status = vi.fn(() => pending.promise);
      const { controller, applyStatus, setState } = fixture({ startMcpAuth: () => Promise.resolve(flow({ status: "complete" })), status }, {}, scope);
      await controller.openMcpAuth("login");
      expect(status).toHaveBeenCalledExactlyOnceWith({ id: session.id, cwd: session.cwd }, machine.id);
      if (changed === "machine") setState({ selectedMachine: { ...machine, id: "remote-b" } });
      if (changed === "session") setState({ selectedSession: { ...session, id: "session-b" } });
      if (changed === "cwd") setState({ selectedSession: { ...session, cwd: "/other" } });
      pending.resolve(returnedStatus);
      await Promise.resolve(); await Promise.resolve();
      if (changed === "none") expect(applyStatus).toHaveBeenCalledExactlyOnceWith(returnedStatus);
      else expect(applyStatus).not.toHaveBeenCalled();
    }
  });

  it.each(["machine", "session", "cwd"] as const)("does not request status if the original MCP %s changed before completion", async (changed) => {
    const pending = deferred<OAuthFlowState>();
    const status = vi.fn();
    const { controller, setState } = fixture({ startMcpAuth: () => pending.promise, status });
    const start = controller.openMcpAuth("login");
    if (changed === "machine") setState({ selectedMachine: { ...machine, id: "remote-b" } });
    if (changed === "session") setState({ selectedSession: { ...session, id: "session-b" } });
    if (changed === "cwd") setState({ selectedSession: { ...session, cwd: "/other" } });
    pending.resolve(flow({ status: "complete" }));
    await start;
    expect(status).not.toHaveBeenCalled();
  });

  it("uses the captured machine/session and shared modal through selection, input and command completion", async () => {
    const pending = deferred<OAuthFlowState>();
    const start = vi.fn(() => pending.promise);
    const respond = vi.fn<typeof api.respondMcpAuthFlow>()
      .mockResolvedValueOnce(flow({ auth: { url: "https://auth.example/authorize" }, prompt: { requestId: "redirect", message: "Paste redirect URL", promptType: "manual_code" } }))
      .mockResolvedValueOnce(flow({ status: "complete", progress: ["Signed in to MCP server."] }));
    const { controller, state, setState } = fixture({ startMcpAuth: start, respondMcpAuthFlow: respond });
    const starting = controller.openMcpAuth("login");
    expect(state().authDialog).toMatchObject({ step: "starting", target: { machineId: machine.id } });
    expect(start).toHaveBeenCalledWith({ id: session.id, cwd: session.cwd }, "login", machine.id);
    setState({ selectedMachine: undefined, selectedSession: { ...session, id: "session-b" } });
    pending.resolve(flow({ select: { requestId: "server", message: "MCP server", options: [{ value: "alpha", label: "alpha" }] } }));
    await starting;
    await controller.respondOAuth("alpha");
    expect(respond).toHaveBeenLastCalledWith("mcp-flow", "server", "alpha", machine.id);
    controller.updateOAuthInput("http://127.0.0.1/callback?code=abc&state=xyz");
    await controller.respondOAuth();
    expect(respond).toHaveBeenLastCalledWith("mcp-flow", "redirect", "http://127.0.0.1/callback?code=abc&state=xyz", machine.id);
    expect(state().authDialog).toMatchObject({ step: "oauth", flow: { target: "mcp", status: "complete", progress: ["Signed in to MCP server."] } });
    await controller.cancelOAuth();
    expect(state().authDialog).toBeUndefined();
  });

  it("polls the MCP endpoint and removes a callback prompt without cancelling the operation", async () => {
    const prompt = { requestId: "redirect", message: "Paste URL", promptType: "manual_code" as const };
    const read = vi.fn<typeof api.mcpAuthFlow>()
      .mockResolvedValueOnce(flow({ prompt }))
      .mockResolvedValueOnce(flow())
      .mockResolvedValueOnce(flow({ status: "complete", progress: ["Pi finished"] }));
    const { controller, state } = fixture({ startMcpAuth: () => Promise.resolve(flow({ prompt })), mcpAuthFlow: read });
    await controller.openMcpAuth("login");
    controller.updateOAuthInput("half-typed URL");
    await tick();
    expect(state().authDialog).toMatchObject({ inputValue: "half-typed URL" });
    await tick();
    expect(state().authDialog).toMatchObject({ step: "oauth", flow: { status: "running" }, inputValue: "" });
    const dialog = state().authDialog;
    expect(dialog?.step === "oauth" ? dialog.flow.prompt : undefined).toBeUndefined();
    await tick();
    expect(read).toHaveBeenLastCalledWith("mcp-flow", machine.id);
    expect(state().authDialog).toMatchObject({ flow: { status: "complete" } });
  });

  it("keeps cancellation visible, ignores pre-cancel polls, and waits for Pi to finish", async () => {
    const oldRead = deferred<OAuthFlowState>();
    const read = vi.fn<typeof api.mcpAuthFlow>()
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(flow({ status: "complete", cancelRequested: true, progress: ["Pi finished"] }));
    const cancel = vi.fn(() => Promise.resolve(flow({ cancelRequested: true })));
    const { controller, state } = fixture({ startMcpAuth: () => Promise.resolve(flow()), mcpAuthFlow: read, cancelMcpAuthFlow: cancel });
    await controller.openMcpAuth("login");
    await tick();
    await controller.cancelOAuth();
    expect(cancel).toHaveBeenCalledWith("mcp-flow", machine.id);
    expect(state().authDialog).toMatchObject({ flow: { status: "running", cancelRequested: true } });
    oldRead.resolve(flow());
    await Promise.resolve(); await Promise.resolve();
    expect(state().authDialog).toMatchObject({ flow: { cancelRequested: true } });
    await tick();
    expect(state().authDialog).toMatchObject({ flow: { status: "complete", cancelRequested: true } });
  });

  it("cancels an allocated MCP flow after the start dialog was closed", async () => {
    const pending = deferred<OAuthFlowState>();
    const cancel = vi.fn(() => Promise.resolve(flow({ cancelRequested: true })));
    const { controller, state } = fixture({ startMcpAuth: () => pending.promise, cancelMcpAuthFlow: cancel });
    const starting = controller.openMcpAuth("login");
    controller.closeDialog();
    pending.resolve(flow());
    await starting;
    expect(cancel).toHaveBeenCalledWith("mcp-flow", machine.id);
    expect(state().authDialog).toBeUndefined();
  });

  it("shows a failed start in the same modal", async () => {
    const { controller, state } = fixture({ startMcpAuth: () => Promise.reject(new Error("Restart the session daemon")) });
    await controller.openMcpAuth("login");
    expect(state().authDialog).toMatchObject({ step: "starting", error: "Error: Restart the session daemon" });
  });

  it("allows retrying cancellation after a transport failure", async () => {
    const cancel = vi.fn<typeof api.cancelMcpAuthFlow>().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(flow({ cancelRequested: true }));
    const { controller, state } = fixture({ startMcpAuth: () => Promise.resolve(flow()), cancelMcpAuthFlow: cancel });
    await controller.openMcpAuth("login");
    await controller.cancelOAuth();
    expect(state().authDialog).toMatchObject({ flow: { cancelRequested: false }, error: "Error: Offline" });
    await controller.cancelOAuth();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("uses the explicit settings target without falling back to the newly selected session", async () => {
    const start = vi.fn(() => Promise.resolve(flow({ mcpMode: "logout", providerName: "Budgeter", status: "complete", progress: ["Signed out of Budgeter"] })));
    const origin = { session: { id: "original-session", cwd: "/original" }, machineId: "original-machine" };
    const { controller, state } = fixture({ startMcpAuth: start }, { selectedSession: { ...session, id: "other-session" } });
    await controller.openMcpAuth("logout", "Budgeter", origin);
    expect(start).toHaveBeenCalledWith(origin.session, "logout", origin.machineId, "Budgeter");
    expect(state().authDialog).toMatchObject({ target: { machineId: origin.machineId }, flow: { providerName: "Budgeter", mcpMode: "logout" } });
  });

  it("starts sign-out through the same scoped API", async () => {
    const start = vi.fn(() => Promise.resolve(flow({ status: "complete", progress: ["Signed out"] })));
    const { controller, state } = fixture({ startMcpAuth: start });
    await controller.openMcpAuth("logout");
    expect(start).toHaveBeenCalledWith({ id: session.id, cwd: session.cwd }, "logout", machine.id);
    expect(state().authDialog).toMatchObject({ step: "oauth", flow: { status: "complete", progress: ["Signed out"] } });
  });

  it.each([undefined, { ...session, archived: true }])("requires a selected nonarchived session", async (selectedSession) => {
    const start = vi.fn();
    const { controller } = fixture({ startMcpAuth: start }, { selectedSession });
    await controller.openMcpAuth("login");
    expect(start).not.toHaveBeenCalled();
  });
});

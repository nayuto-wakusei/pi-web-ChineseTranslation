import { describe, expect, it } from "vitest";
import { api as defaultApi, type ApiScope, type AuthProviderOption, type OAuthFlowState, type Project, type SessionInfo, type SessionStatus } from "../api";
import { initialAppState, type AppState, type AuthDialogTarget } from "../appState";
import { AuthController, parseAuthSlashCommand } from "./authController";

describe("parseAuthSlashCommand", () => {
  it("parses login and logout commands", () => {
    expect(parseAuthSlashCommand("/login")).toEqual({ command: "login" });
    expect(parseAuthSlashCommand("/logout")).toEqual({ command: "logout" });
  });

  it("parses provider arguments", () => {
    expect(parseAuthSlashCommand("/login openai")).toEqual({ command: "login", providerId: "openai" });
    expect(parseAuthSlashCommand("/logout openai-codex ")).toEqual({ command: "logout", providerId: "openai-codex" });
  });

  it("ignores non-auth commands and extra arguments", () => {
    expect(parseAuthSlashCommand("/model")).toBeUndefined();
    expect(parseAuthSlashCommand("hello /login")).toBeUndefined();
    expect(parseAuthSlashCommand("/login openai extra")).toBeUndefined();
  });
});

describe("AuthController", () => {
  it("requires a selected project before opening normal-mode auth", async () => {
    const { controller, getState } = createController({ selectedProject: undefined });

    await controller.openLogin();

    expect(getState().authDialog).toBeUndefined();
    expect(getState().error).toBe("请先选择项目，再配置提供商认证。");
  });

  it("allows management auth without a selected project", async () => {
    const { controller, getState } = createController({ selectedProject: undefined }, {}, () => undefined, "management");

    await controller.openLogin();

    expect(getState().authDialog).toEqual({ step: "method", target: { machineId: "local" } });
  });

  it("binds provider auth requests to the selected project", async () => {
    const authCalls: Parameters<typeof defaultApi.authProviders>[0][] = [];
    const project = projectInfo("project-1");
    const { controller, getState } = createController(
      { selectedProject: project },
      {
        authProviders: (options) => {
          authCalls.push(options);
          return Promise.resolve({ providers: [] });
        },
      },
    );

    await controller.openLogin();
    await controller.chooseLoginMethod("api_key");

    expect(authCalls).toEqual([{ mode: "login", authType: "api_key", ...normalTarget() }]);
    expect(getState().authDialog).toMatchObject({ step: "providers", target: { projectId: project.id, projectName: project.name } });
  });

  it("uses auth type to disambiguate provider options with the same id", async () => {
    const providers = [authProvider("anthropic", "oauth"), authProvider("anthropic", "api_key")];
    const { controller, getState } = createController({ authDialog: { step: "providers", mode: "login", providers, target: normalTarget() } });

    await controller.selectLoginProvider("anthropic", "api_key");

    expect(getState().authDialog).toMatchObject({ step: "apiKey", provider: { id: "anthropic", authType: "api_key" } });
  });

  it("starts remote OAuth with the captured machine and project target", async () => {
    const provider = authProvider("openai", "oauth");
    const target = remoteTarget("remote-1");
    const calls: Parameters<typeof defaultApi.startOAuthLogin>[] = [];
    const { controller, getState } = createController(
      {
        selectedMachine: remoteMachine("remote-1"),
        authDialog: { step: "providers", mode: "login", providers: [provider], target },
      },
      {
        startOAuthLogin: (providerId, requestTarget) => {
          calls.push([providerId, requestTarget]);
          return Promise.resolve(oauthFlow({ status: "complete" }));
        },
      },
    );

    await controller.selectLoginProvider(provider.id, provider.authType);

    expect(calls).toEqual([[provider.id, target]]);
    expect(getState().error).toBe("");
  });

  it("logs an OAuth provider out through its captured remote target", async () => {
    const provider = authProvider("openai", "oauth");
    const target = remoteTarget("remote-1");
    const calls: Parameters<typeof defaultApi.logoutProvider>[] = [];
    const { controller, getState } = createController(
      { authDialog: { step: "logout", providers: [provider], target } },
      {
        logoutProvider: (providerId, requestTarget) => {
          calls.push([providerId, requestTarget]);
          return Promise.resolve({ accepted: true });
        },
      },
    );

    await controller.logoutProvider(provider.id);

    expect(calls).toEqual([[provider.id, target]]);
    expect(getState().authDialog).toBeUndefined();
  });

  it("keeps OAuth prompt input and submit state across poll refreshes for the same request", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow, inputValue: "https://callback", target: normalTarget() } },
      { respondOAuthFlow: () => Promise.resolve(oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" }, progress: ["Still waiting"] })) },
    );

    await controller.respondOAuth();

    expect(getState().authDialog).toMatchObject({ step: "oauth", inputValue: "https://callback", responding: true });
  });

  it("submits one response while the same OAuth request is already in flight", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    let resolveResponse!: (value: OAuthFlowState) => void;
    const response = new Promise<OAuthFlowState>((resolve) => { resolveResponse = resolve; });
    let calls = 0;
    const { controller } = createController(
      { authDialog: { step: "oauth", flow, inputValue: "https://callback", target: normalTarget() } },
      { respondOAuthFlow: () => { calls += 1; return response; } },
    );

    const first = controller.respondOAuth();
    await controller.respondOAuth();
    expect(calls).toBe(1);

    resolveResponse(oauthFlow({ status: "complete" }));
    await first;
  });

  it("resets OAuth prompt input and submit state when the request id changes", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow, inputValue: "https://callback", target: normalTarget() } },
      {
        respondOAuthFlow: () => Promise.resolve(oauthFlow({
          select: { requestId: "request-2", message: "Choose an account", options: [{ value: "acct-1", label: "Account 1" }] },
          progress: ["Need account selection"],
        })),
      },
    );

    await controller.respondOAuth();

    expect(getState().authDialog).toMatchObject({
      step: "oauth",
      flow: { select: { requestId: "request-2" } },
      inputValue: "",
      responding: false,
    });
  });

  it("closes the OAuth dialog and refreshes selected session status when the flow completes", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    const session = sessionInfo("session-1");
    const refreshedStatus = sessionStatus(session.id);
    const respondCalls: { flowId: string; requestId: string; value: string; target: Parameters<typeof defaultApi.respondOAuthFlow>[3] }[] = [];
    const statusCalls: { session: Parameters<typeof defaultApi.status>[0]; machineId: string | undefined }[] = [];
    const appliedStatuses: SessionStatus[] = [];
    const { controller, getState } = createController(
      { selectedSession: session, authDialog: { step: "oauth", flow, inputValue: "https://callback", target: normalTarget() } },
      {
        respondOAuthFlow: (flowId, requestId, value, target) => {
          respondCalls.push({ flowId, requestId, value, target });
          return Promise.resolve(oauthFlow({ status: "complete" }));
        },
        status: (sessionArg, machineId) => {
          statusCalls.push({ session: sessionArg, machineId });
          return Promise.resolve(refreshedStatus);
        },
      },
      (status) => { appliedStatuses.push(status); },
    );

    await controller.respondOAuth();
    await flushMicrotasks();

    expect(respondCalls).toEqual([{ flowId: "flow-1", requestId: "request-1", value: "https://callback", target: normalTarget() }]);
    expect(getState().authDialog).toBeUndefined();
    expect(statusCalls).toEqual([{ session, machineId: "local" }]);
    expect(appliedStatuses).toEqual([refreshedStatus]);
  });

  it("leaves the OAuth dialog ready to retry if responding fails", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow, inputValue: "https://callback", target: normalTarget() } },
      { respondOAuthFlow: () => Promise.reject(new Error("Invalid callback")) },
    );

    await controller.respondOAuth();

    expect(getState().authDialog).toMatchObject({
      step: "oauth",
      flow,
      inputValue: "https://callback",
      responding: false,
      error: "Error: Invalid callback",
    });
  });

  it("cancels the active OAuth flow and closes the dialog even when cancellation fails", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    const cancelCalls: { flowId: string; target: Parameters<typeof defaultApi.cancelOAuthFlow>[1] }[] = [];
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow, target: normalTarget() } },
      {
        cancelOAuthFlow: (flowId, target) => {
          cancelCalls.push({ flowId, target });
          return Promise.reject(new Error("Cancel unavailable"));
        },
      },
    );

    await controller.cancelOAuth();

    expect(cancelCalls).toEqual([{ flowId: "flow-1", target: normalTarget() }]);
    expect(getState().authDialog).toBeUndefined();
  });

  it("validates API key input before saving and clears the validation error when edited", async () => {
    const saveCalls: { providerId: string; key: string; target: Parameters<typeof defaultApi.saveApiKey>[2] }[] = [];
    const provider = authProvider("openai", "api_key");
    const { controller, getState } = createController(
      { authDialog: { step: "apiKey", provider, value: "   ", target: normalTarget() } },
      {
        saveApiKey: (providerId, key, target) => {
          saveCalls.push({ providerId, key, target });
          return Promise.resolve({ accepted: true });
        },
      },
    );

    await controller.saveApiKey();

    expect(saveCalls).toEqual([]);
    expect(getState().authDialog).toMatchObject({ step: "apiKey", error: "必须填写 API key" });

    controller.updateApiKey("sk-live");

    expect(getState().authDialog).toMatchObject({ step: "apiKey", value: "sk-live" });
    expect(getState().authDialog).not.toHaveProperty("error");
  });

  it("saves a trimmed API key on the selected machine and refreshes selected session status", async () => {
    const saveCalls: { providerId: string; key: string; target: Parameters<typeof defaultApi.saveApiKey>[2] }[] = [];
    const statusCalls: { session: Parameters<typeof defaultApi.status>[0]; machineId: string | undefined }[] = [];
    const appliedStatuses: SessionStatus[] = [];
    const provider = authProvider("openai", "api_key");
    const session = sessionInfo("session-1");
    const refreshedStatus = sessionStatus(session.id);
    const { controller, getState } = createController(
      {
        selectedMachine: remoteMachine("remote-1"),
        selectedSession: session,
        authDialog: { step: "apiKey", provider, value: "  sk-live  ", target: remoteTarget("remote-1") },
      },
      {
        saveApiKey: (providerId, key, target) => {
          saveCalls.push({ providerId, key, target });
          return Promise.resolve({ accepted: true });
        },
        status: (sessionArg, machineId) => {
          statusCalls.push({ session: sessionArg, machineId });
          return Promise.resolve(refreshedStatus);
        },
      },
      (status) => { appliedStatuses.push(status); },
    );

    await controller.saveApiKey();
    await flushMicrotasks();

    expect(saveCalls).toEqual([{ providerId: "openai", key: "sk-live", target: remoteTarget("remote-1") }]);
    expect(getState().authDialog).toBeUndefined();
    expect(statusCalls).toEqual([{ session, machineId: "remote-1" }]);
    expect(appliedStatuses).toEqual([refreshedStatus]);
  });

  it("keeps the API key dialog open with an error if saving fails", async () => {
    const provider = authProvider("openai", "api_key");
    const { controller, getState } = createController(
      { authDialog: { step: "apiKey", provider, value: "sk-live", target: normalTarget() } },
      { saveApiKey: () => Promise.reject(new Error("Denied")) },
    );

    await controller.saveApiKey();

    expect(getState().authDialog).toMatchObject({ step: "apiKey", value: "sk-live", saving: false, error: "Error: Denied" });
  });
});

function createController(
  statePatch: Partial<AppState>,
  apiPatch: Partial<typeof defaultApi> = {},
  applyStatus: (status: SessionStatus) => void = () => undefined,
  scope: ApiScope = "normal",
) {
  let state: AppState = { ...initialAppState(), selectedProject: projectInfo("project-1"), ...statePatch };
  const api = { ...defaultApi, ...apiPatch };
  const controller = new AuthController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    applyStatus,
    { api, scope },
  );
  return { controller, getState: () => state };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function remoteMachine(id: string): NonNullable<AppState["selectedMachine"]> {
  return {
    id,
    name: "Remote",
    kind: "remote",
    baseUrl: "https://remote.example",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function sessionInfo(id: string): SessionInfo {
  return {
    id,
    cwd: "/repo",
    path: `/tmp/${id}.jsonl`,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 0,
    firstMessage: "",
  };
}

function projectInfo(id: string): Project {
  return { id, name: "Project One", path: "/repo", createdAt: "2026-01-01T00:00:00.000Z" };
}

function normalTarget(): AuthDialogTarget {
  return { machineId: "local", projectId: "project-1", projectName: "Project One" };
}

function remoteTarget(machineId: string): AuthDialogTarget {
  return { ...normalTarget(), machineId, machineKind: "remote" };
}

function sessionStatus(sessionId: string): SessionStatus {
  return {
    sessionId,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function authProvider(id: string, authType: "oauth" | "api_key"): AuthProviderOption {
  return { id, authType, name: `${id} ${authType}`, status: { configured: false } };
}

function oauthFlow(patch: Partial<OAuthFlowState> = {}): OAuthFlowState {
  return {
    flowId: "flow-1",
    providerId: "anthropic",
    providerName: "Anthropic",
    status: "running",
    progress: [],
    ...patch,
  };
}

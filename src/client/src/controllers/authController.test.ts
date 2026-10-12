import { vi } from "vitest";
import { browserErrorScopeKey, machineBrowserErrorScope } from "../browserErrors";
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
  it("keeps a newer login dialog when an older key save finishes", async () => {
    let finish!: (value: { accepted: true }) => void;
    const saved = new Promise<{ accepted: true }>((resolve) => { finish = resolve; });
    const { controller, getState } = createController({
      authDialog: { step: "apiKey", provider: authProvider("openai", "api_key"), value: "test-key", target: normalTarget() },
    }, { saveApiKey: () => saved });
    const pending = controller.saveApiKey();
    await controller.openLogin();
    finish({ accepted: true });
    await pending;
    expect(getState().authDialog).toMatchObject({ step: "method" });
  });

  it("does not reopen a cancelled dialog when provider discovery finishes", async () => {
    let resolve!: (value: { providers: AuthProviderOption[] }) => void;
    const providers = new Promise<{ providers: AuthProviderOption[] }>((done) => { resolve = done; });
    const { controller, getState } = createController({}, { authProviders: () => providers });
    await controller.openLogin();
    const pending = controller.chooseLoginMethod("oauth");
    controller.closeDialog();
    resolve({ providers: [authProvider("openai", "oauth")] });
    await pending;
    expect(getState().authDialog).toBeUndefined();
  });

  it("does not revive an obsolete OAuth response after opening another dialog", async () => {
    let resolve!: (value: OAuthFlowState) => void;
    const response = new Promise<OAuthFlowState>((done) => { resolve = done; });
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Callback", kind: "manual" } });
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow, target: normalTarget() } },
      { respondOAuthFlow: () => response },
    );
    const pending = controller.respondOAuth("callback");
    await controller.openLogin();
    resolve(flow);
    await pending;
    expect(getState().authDialog).toMatchObject({ step: "method", target: normalTarget() });
  });

  it("requires a selected project before opening normal-mode auth", async () => {
    const { controller, getState } = createController({ selectedProject: undefined });

    await controller.openLogin();

    expect(getState().authDialog).toBeUndefined();
    expect(Object.values(getState().browserErrors).map((error) => error.message)).toContain("请先选择项目，再配置提供商认证。");
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
  return { controller, getState: () => state, setState: (patch: Partial<AppState>) => { state = { ...state, ...patch }; } };
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolveDeferred: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { resolveDeferred = resolve; });
  if (resolveDeferred === undefined) throw new Error("Deferred promise was not initialized");
  return { promise, resolve: resolveDeferred };
}
describe("Upstream transport and navigation contracts", () => {
  it("starts provider-driven API-key interactions for interactive providers", async () => {
    vi.stubGlobal("window", { setInterval: () => 1, clearInterval: () => undefined });
    const provider: AuthProviderOption = { ...authProvider("amazon-bedrock", "api_key"), loginFlow: "interactive" };
    const calls: { providerId: string; machineId: string | undefined }[] = [];
    const { controller, getState } = createController(
      { authDialog: { step: "providers", mode: "login", target: normalTarget(), authType: "api_key", providers: [provider] } },
      {
        startInteractiveApiKeyLogin: (providerId, target) => {
          const machineId = target.machineId;
          calls.push({ providerId, machineId });
          return Promise.resolve(oauthFlow({ providerId, providerName: "Amazon Bedrock", select: { requestId: "request-1", message: "Choose method", options: [] } }));
        },
      },
    );

    try {
      await controller.selectLoginProvider(provider.id, "api_key");

      expect(calls).toEqual([{ providerId: "amazon-bedrock", machineId: "local" }]);
      expect(getState().authDialog).toMatchObject({
        step: "oauth",
        flow: { providerId: "amazon-bedrock", select: { requestId: "request-1" } },
      });
    } finally {
      controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("reports provider discovery failures under the machine that owns the auth dialog", async () => {
    const machine = remoteMachine("remote-1");
    const failure = new Error("Auth providers unavailable");
    const { controller, getState } = createController(
      { selectedMachine: machine, error: "A global failure" },
      { authProviders: () => Promise.reject(failure) },
    );

    await controller.openLogin();
    await controller.chooseLoginMethod("oauth");

    expect(getState().error).toBe("A global failure");
    expect(getState().browserErrors[browserErrorScopeKey(machineBrowserErrorScope(machine.id))]?.message).toBe(String(failure));
  });

  it("reports direct login failures under the machine that owns the request", async () => {
    const machine = remoteMachine("remote-1");
    const provider = authProvider("anthropic", "oauth");
    const failure = new Error("Login flow unavailable");
    const { controller, getState } = createController(
      { selectedMachine: machine, error: "A global failure" },
      {
        authProviders: () => Promise.resolve({ providers: [provider] }),
        startOAuthLogin: () => Promise.reject(failure),
      },
    );

    await controller.openLogin(provider.id);

    expect(getState().error).toBe("A global failure");
    expect(getState().browserErrors[browserErrorScopeKey(machineBrowserErrorScope(machine.id))]?.message).toBe(String(failure));
  });

  it("reports logout failures under the machine that owns the request", async () => {
    const machine = remoteMachine("remote-1");
    const provider = authProvider("anthropic", "oauth");
    const failure = new Error("Logout unavailable");
    const { controller, getState } = createController(
      { selectedMachine: machine, error: "A global failure", authDialog: { step: "logout", target: remoteTarget(machine.id), providers: [provider] } },
      { logoutProvider: () => Promise.reject(failure) },
    );

    await controller.logoutProvider(provider.id);

    expect(getState().error).toBe("A global failure");
    expect(getState().browserErrors[browserErrorScopeKey(machineBrowserErrorScope(machine.id))]?.message).toBe(String(failure));
  });

  it("starts, polls, and cancels a federated OAuth login on the selected remote machine", async () => {
    let pollCallback: (() => void) | undefined;
    vi.stubGlobal("window", {
      setInterval: (callback: () => void) => {
        pollCallback = callback;
        return 1;
      },
      clearInterval: () => undefined,
    });
    const provider = authProvider("anthropic", "oauth");
    const flow = oauthFlow({ auth: { url: "https://provider.example/authorize" }, prompt: { requestId: "request-1", message: "Paste callback", promptType: "manual_code" } });
    const startCalls: { providerId: string; machineId: string | undefined }[] = [];
    const pollCalls: { flowId: string; machineId: string | undefined }[] = [];
    const cancelCalls: { flowId: string; machineId: string | undefined }[] = [];
    const { controller, getState } = createController(
      {
        selectedMachine: remoteMachine("remote-1"),
        authDialog: { step: "providers", mode: "login", target: remoteTarget("remote-1"), authType: "oauth", providers: [provider] },
      },
      {
        startOAuthLogin: (providerId, target) => {
          const machineId = target.machineId;
          startCalls.push({ providerId, machineId });
          return Promise.resolve(flow);
        },
        oauthFlow: (flowId, target) => {
          const machineId = target.machineId;
          pollCalls.push({ flowId, machineId });
          return Promise.resolve(flow);
        },
        cancelOAuthFlow: (flowId, target) => {
          const machineId = target.machineId;
          cancelCalls.push({ flowId, machineId });
          return Promise.resolve(oauthFlow({ status: "cancelled" }));
        },
      },
    );

    try {
      await controller.selectLoginProvider(provider.id, "oauth");

      expect(startCalls).toEqual([{ providerId: "anthropic", machineId: "remote-1" }]);
      expect(getState().authDialog).toMatchObject({ step: "oauth", target: remoteTarget("remote-1"), flow: { flowId: "flow-1" } });
      expect(getState().error).toBe("");

      if (pollCallback === undefined) throw new Error("Expected auth polling to start");
      pollCallback();
      await flushMicrotasks();

      expect(pollCalls).toEqual([{ flowId: "flow-1", machineId: "remote-1" }]);

      await controller.cancelOAuth();

      expect(cancelCalls).toEqual([{ flowId: "flow-1", machineId: "remote-1" }]);
      expect(getState().authDialog).toBeUndefined();
    } finally {
      controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("completes a federated OAuth login by responding to the remote machine that owns the flow", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", promptType: "manual_code" } });
    const session = sessionInfo("session-1");
    const refreshedStatus = sessionStatus(session.id);
    const respondCalls: { flowId: string; requestId: string; value: string; machineId: string | undefined }[] = [];
    const statusCalls: { machineId: string | undefined }[] = [];
    const appliedStatuses: SessionStatus[] = [];
    const { controller, getState } = createController(
      {
        selectedMachine: remoteMachine("remote-1"),
        selectedSession: session,
        authDialog: { step: "oauth", flow, target: remoteTarget("remote-1"), inputValue: "https://localhost:54545/callback?code=abc" },
      },
      {
        respondOAuthFlow: (flowId, requestId, value, target) => {
          const machineId = target.machineId;
          respondCalls.push({ flowId, requestId, value, machineId });
          return Promise.resolve(oauthFlow({ status: "complete" }));
        },
        status: (_session, machineId) => {
          statusCalls.push({ machineId });
          return Promise.resolve(refreshedStatus);
        },
      },
      (status) => { appliedStatuses.push(status); },
    );

    await controller.respondOAuth();
    await flushMicrotasks();

    expect(respondCalls).toEqual([{ flowId: "flow-1", requestId: "request-1", value: "https://localhost:54545/callback?code=abc", machineId: "remote-1" }]);
    expect(getState().authDialog).toBeUndefined();
    expect(statusCalls).toEqual([{ machineId: "remote-1" }]);
    expect(appliedStatuses).toEqual([refreshedStatus]);
  });

  it("logs an OAuth provider out on the selected remote machine", async () => {
    const provider = authProvider("anthropic", "oauth");
    const logoutCalls: { providerId: string; machineId: string | undefined }[] = [];
    const { controller, getState } = createController(
      {
        selectedMachine: remoteMachine("remote-1"),
        authDialog: { step: "logout", target: remoteTarget("remote-1"), providers: [provider] },
      },
      {
        logoutProvider: (providerId, target) => {
          const machineId = target.machineId;
          logoutCalls.push({ providerId, machineId });
          return Promise.resolve({ accepted: true as const });
        },
      },
    );

    await controller.logoutProvider(provider.id);

    expect(logoutCalls).toEqual([{ providerId: "anthropic", machineId: "remote-1" }]);
    expect(getState().authDialog).toBeUndefined();
    expect(getState().error).toBe("");
  });

  it("logs an OAuth provider out on a remote machine from the /logout command", async () => {
    const provider = authProvider("anthropic", "oauth");
    const logoutCalls: { providerId: string; machineId: string | undefined }[] = [];
    const { controller, getState } = createController(
      { selectedMachine: remoteMachine("remote-1") },
      {
        authProviders: () => Promise.resolve({ providers: [provider] }),
        logoutProvider: (providerId, target) => {
          const machineId = target.machineId;
          logoutCalls.push({ providerId, machineId });
          return Promise.resolve({ accepted: true as const });
        },
      },
    );

    await controller.openLogout(provider.id);

    expect(logoutCalls).toEqual([{ providerId: "anthropic", machineId: "remote-1" }]);
    expect(getState().error).toBe("");
  });

  it("keeps method-based provider selection bound to the machine where login opened", async () => {
    const provider = authProvider("anthropic", "oauth");
    const providerLookup = deferred<{ providers: AuthProviderOption[] }>();
    const providerLookupMachines: (string | undefined)[] = [];
    const startMachines: (string | undefined)[] = [];
    const { controller, getState, setState } = createController(
      { selectedMachine: remoteMachine("remote-a") },
      {
        authProviders: (options) => {
          providerLookupMachines.push(options.machineId);
          return providerLookup.promise;
        },
        startOAuthLogin: (_providerId, target) => {
          const machineId = target.machineId;
          startMachines.push(machineId);
          return Promise.resolve(oauthFlow({ status: "complete" }));
        },
      },
    );

    await controller.openLogin();
    expect(getState().authDialog).toEqual({ step: "method", target: remoteTarget("remote-a") });

    const pendingLookup = controller.chooseLoginMethod("oauth");
    setState({ selectedMachine: remoteMachine("remote-b") });
    providerLookup.resolve({ providers: [provider] });
    await pendingLookup;

    expect(providerLookupMachines).toEqual(["remote-a"]);
    expect(getState().authDialog).toMatchObject({ step: "providers", target: remoteTarget("remote-a"), providers: [provider] });

    await controller.selectLoginProvider(provider.id, provider.authType);

    expect(startMachines).toEqual(["remote-a"]);
  });

  it("keeps a direct login command bound while provider discovery is pending", async () => {
    const provider = authProvider("anthropic", "oauth");
    const providerLookup = deferred<{ providers: AuthProviderOption[] }>();
    const startMachines: (string | undefined)[] = [];
    const { controller, setState } = createController(
      { selectedMachine: remoteMachine("remote-a") },
      {
        authProviders: () => providerLookup.promise,
        startOAuthLogin: (_providerId, target) => {
          const machineId = target.machineId;
          startMachines.push(machineId);
          return Promise.resolve(oauthFlow({ status: "complete" }));
        },
      },
    );

    const pendingLogin = controller.openLogin(provider.id);
    setState({ selectedMachine: remoteMachine("remote-b") });
    providerLookup.resolve({ providers: [provider] });
    await pendingLogin;

    expect(startMachines).toEqual(["remote-a"]);
  });

  it("ignores stale direct login discovery after a newer remote flow starts", async () => {
    const provider = authProvider("anthropic", "oauth");
    const staleProviderLookup = deferred<{ providers: AuthProviderOption[] }>();
    const startCalls: { providerId: string; machineId: string | undefined }[] = [];
    const pollCalls: { flowId: string; machineId: string | undefined }[] = [];
    const clearedTimers: number[] = [];
    let pollCallback: (() => void) | undefined;
    vi.stubGlobal("window", {
      setInterval: (callback: () => void) => {
        pollCallback = callback;
        return 7;
      },
      clearInterval: (timer: number) => { clearedTimers.push(timer); },
    });
    const { controller, getState, setState } = createController(
      { selectedMachine: remoteMachine("remote-a") },
      {
        authProviders: (options) => options.machineId === "remote-a"
          ? staleProviderLookup.promise
          : Promise.resolve({ providers: [provider] }),
        startOAuthLogin: (providerId, target) => {
          const machineId = target.machineId;
          startCalls.push({ providerId, machineId });
          return Promise.resolve(oauthFlow({ flowId: machineId === "remote-b" ? "flow-b" : "flow-a" }));
        },
        oauthFlow: (flowId, target) => {
          const machineId = target.machineId;
          pollCalls.push({ flowId, machineId });
          return Promise.resolve(oauthFlow({ flowId }));
        },
      },
    );

    try {
      const staleLogin = controller.openLogin(provider.id);
      setState({ selectedMachine: remoteMachine("remote-b") });
      await controller.openLogin(provider.id);
      const newerDialog = getState().authDialog;
      const newerPollCallback = pollCallback;
      if (newerPollCallback === undefined) throw new Error("Expected newer auth polling to start");

      expect(startCalls).toEqual([{ providerId: "anthropic", machineId: "remote-b" }]);
      expect(newerDialog).toMatchObject({ step: "oauth", target: remoteTarget("remote-b"), flow: { flowId: "flow-b" } });

      staleProviderLookup.resolve({ providers: [provider] });
      await staleLogin;

      expect(startCalls).toEqual([{ providerId: "anthropic", machineId: "remote-b" }]);
      expect(getState().authDialog).toBe(newerDialog);
      expect(clearedTimers).toEqual([]);

      newerPollCallback();
      await flushMicrotasks();

      expect(pollCalls).toEqual([{ flowId: "flow-b", machineId: "remote-b" }]);
      expect(getState().authDialog).toMatchObject({ step: "oauth", target: remoteTarget("remote-b"), flow: { flowId: "flow-b" } });
    } finally {
      staleProviderLookup.resolve({ providers: [provider] });
      controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("keeps dialog logout bound while provider discovery is pending", async () => {
    const provider = authProvider("anthropic", "oauth");
    const providerLookup = deferred<{ providers: AuthProviderOption[] }>();
    const logoutMachines: (string | undefined)[] = [];
    const statusMachines: (string | undefined)[] = [];
    const { controller, getState, setState } = createController(
      { selectedMachine: remoteMachine("remote-a"), selectedSession: sessionInfo("session-a") },
      {
        authProviders: () => providerLookup.promise,
        logoutProvider: (_providerId, target) => {
          const machineId = target.machineId;
          logoutMachines.push(machineId);
          return Promise.resolve({ accepted: true as const });
        },
        status: (session, machineId) => {
          statusMachines.push(machineId);
          return Promise.resolve(sessionStatus(session.id));
        },
      },
    );

    const pendingLookup = controller.openLogout();
    setState({ selectedMachine: remoteMachine("remote-b"), selectedSession: sessionInfo("session-b") });
    providerLookup.resolve({ providers: [provider] });
    await pendingLookup;

    expect(getState().authDialog).toMatchObject({ step: "logout", target: remoteTarget("remote-a"), providers: [provider] });

    await controller.logoutProvider(provider.id);
    await flushMicrotasks();

    expect(logoutMachines).toEqual(["remote-a"]);
    expect(statusMachines).toEqual([]);
  });

  it("keeps a direct logout command bound while provider discovery is pending", async () => {
    const provider = authProvider("anthropic", "oauth");
    const providerLookup = deferred<{ providers: AuthProviderOption[] }>();
    const logoutMachines: (string | undefined)[] = [];
    const { controller, setState } = createController(
      { selectedMachine: remoteMachine("remote-a") },
      {
        authProviders: () => providerLookup.promise,
        logoutProvider: (_providerId, target) => {
          const machineId = target.machineId;
          logoutMachines.push(machineId);
          return Promise.resolve({ accepted: true as const });
        },
      },
    );

    const pendingLogout = controller.openLogout(provider.id);
    setState({ selectedMachine: remoteMachine("remote-b") });
    providerLookup.resolve({ providers: [provider] });
    await pendingLogout;

    expect(logoutMachines).toEqual(["remote-a"]);
  });

  it("ignores stale direct logout discovery after a newer dialog opens", async () => {
    const provider = authProvider("anthropic", "oauth");
    const staleProviderLookup = deferred<{ providers: AuthProviderOption[] }>();
    const logoutMachines: (string | undefined)[] = [];
    const { controller, getState, setState } = createController(
      { selectedMachine: remoteMachine("remote-a") },
      {
        authProviders: (options) => options.machineId === "remote-a"
          ? staleProviderLookup.promise
          : Promise.resolve({ providers: [provider] }),
        logoutProvider: (_providerId, target) => {
          const machineId = target.machineId;
          logoutMachines.push(machineId);
          return Promise.resolve({ accepted: true as const });
        },
      },
    );

    const staleLogout = controller.openLogout(provider.id);
    setState({ selectedMachine: remoteMachine("remote-b") });
    await controller.openLogout();
    const newerDialog = getState().authDialog;

    expect(newerDialog).toMatchObject({ step: "logout", target: remoteTarget("remote-b"), providers: [provider] });

    staleProviderLookup.resolve({ providers: [provider] });
    await staleLogout;

    expect(logoutMachines).toEqual([]);
    expect(getState().authDialog).toBe(newerDialog);
    expect(getState().error).toBe("");
  });

  it("submits an allowed blank OAuth text response without client-side rejection", async () => {
    const flow = oauthFlow({
      prompt: { requestId: "request-1", message: "GitHub Enterprise URL/domain (blank for github.com)", promptType: "text", allowEmpty: true },
    });
    const respondCalls: string[] = [];
    const { controller } = createController(
      { authDialog: { step: "oauth", flow, target: normalTarget(), inputValue: "" } },
      {
        respondOAuthFlow: (_flowId, _requestId, value) => {
          respondCalls.push(value);
          return Promise.resolve(oauthFlow({ status: "complete" }));
        },
      },
    );

    await controller.respondOAuth();

    expect(respondCalls).toEqual([""]);
  });

  it("does not refresh a session from another selected machine when a flow completes", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Enter secret", promptType: "secret" } });
    const respondMachines: (string | undefined)[] = [];
    const statusMachines: (string | undefined)[] = [];
    const appliedStatuses: SessionStatus[] = [];
    const { controller } = createController(
      {
        selectedMachine: remoteMachine("remote-2"),
        selectedSession: sessionInfo("session-2"),
        authDialog: { step: "oauth", flow, target: remoteTarget("remote-1"), inputValue: "secret-value" },
      },
      {
        respondOAuthFlow: (_flowId, _requestId, _value, target) => {
          const machineId = target.machineId;
          respondMachines.push(machineId);
          return Promise.resolve(oauthFlow({ status: "complete" }));
        },
        status: (_session, machineId) => {
          statusMachines.push(machineId);
          return Promise.resolve(sessionStatus("session-2"));
        },
      },
      (status) => { appliedStatuses.push(status); },
    );

    await controller.respondOAuth();
    await flushMicrotasks();

    expect(respondMachines).toEqual(["remote-1"]);
    expect(statusMachines).toEqual([]);
    expect(appliedStatuses).toEqual([]);
  });

  it("does not apply an auth status refresh after the selected session changes", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Enter secret", promptType: "secret" } });
    const originalSession = sessionInfo("session-1");
    const statusResponse = deferred<SessionStatus>();
    const statusCalls: { session: Parameters<typeof defaultApi.status>[0]; machineId: string | undefined }[] = [];
    const appliedStatuses: SessionStatus[] = [];
    const { controller, setState } = createController(
      {
        selectedMachine: remoteMachine("remote-1"),
        selectedSession: originalSession,
        authDialog: { step: "oauth", flow, target: remoteTarget("remote-1"), inputValue: "secret-value" },
      },
      {
        respondOAuthFlow: () => Promise.resolve(oauthFlow({ status: "complete" })),
        status: (session, machineId) => {
          statusCalls.push({ session, machineId });
          return statusResponse.promise;
        },
      },
      (status) => { appliedStatuses.push(status); },
    );

    await controller.respondOAuth();
    setState({ selectedMachine: remoteMachine("remote-2"), selectedSession: sessionInfo("session-2") });
    statusResponse.resolve(sessionStatus(originalSession.id));
    await flushMicrotasks();

    expect(statusCalls).toEqual([{ session: originalSession, machineId: "remote-1" }]);
    expect(appliedStatuses).toEqual([]);
  });

  it("submits an OAuth prompt response once when Enter is pressed again while it is in flight", async () => {
    const prompt = { requestId: "request-1", message: "Paste callback", promptType: "manual_code" } as const;
    const flow = oauthFlow({ prompt });
    const response = deferred<OAuthFlowState>();
    const respondCalls: string[] = [];
    const { controller } = createController(
      { authDialog: { step: "oauth", flow, target: normalTarget(), inputValue: "https://callback" } },
      {
        respondOAuthFlow: (_flowId, _requestId, value) => {
          respondCalls.push(value);
          return response.promise;
        },
      },
    );

    const firstResponse = controller.respondOAuth();
    const secondResponse = controller.respondOAuth();
    await flushMicrotasks();

    expect(respondCalls).toEqual(["https://callback"]);

    response.resolve(oauthFlow({ prompt, progress: ["Still waiting"] }));
    await firstResponse;
    await secondResponse;

    expect(respondCalls).toEqual(["https://callback"]);
  });

  it("submits one OAuth selection when a second option is chosen while the response is in flight", async () => {
    const flow = oauthFlow({
      select: {
        requestId: "request-1",
        message: "Choose an account",
        options: [{ value: "acct-1", label: "Account 1" }, { value: "acct-2", label: "Account 2" }],
      },
    });
    const response = deferred<OAuthFlowState>();
    const respondCalls: string[] = [];
    const { controller } = createController(
      { authDialog: { step: "oauth", flow, target: normalTarget() } },
      {
        respondOAuthFlow: (_flowId, _requestId, value) => {
          respondCalls.push(value);
          return response.promise;
        },
      },
    );

    const firstResponse = controller.respondOAuth("acct-1");
    const secondResponse = controller.respondOAuth("acct-2");
    await flushMicrotasks();

    expect(respondCalls).toEqual(["acct-1"]);

    response.resolve(oauthFlow({ status: "complete" }));
    await firstResponse;
    await secondResponse;

    expect(respondCalls).toEqual(["acct-1"]);
  });

  it("still cancels the flow while an OAuth response is in flight", async () => {
    const prompt = { requestId: "request-1", message: "Paste callback", promptType: "manual_code" } as const;
    const flow = oauthFlow({ prompt });
    const response = deferred<OAuthFlowState>();
    const cancelCalls: { flowId: string; machineId: string | undefined }[] = [];
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow, target: normalTarget(), inputValue: "https://callback" } },
      {
        respondOAuthFlow: () => response.promise,
        cancelOAuthFlow: (flowId, target) => {
          const machineId = target.machineId;
          cancelCalls.push({ flowId, machineId });
          return Promise.resolve(oauthFlow({ status: "cancelled" }));
        },
      },
    );

    const responsePending = controller.respondOAuth();
    await flushMicrotasks();
    await controller.cancelOAuth();

    expect(cancelCalls).toEqual([{ flowId: "flow-1", machineId: "local" }]);
    expect(getState().authDialog).toBeUndefined();

    response.resolve(oauthFlow({ prompt, progress: ["Stale response"] }));
    await responsePending;

    expect(getState().authDialog).toBeUndefined();
  });

  it("lets the user resubmit the same OAuth request after a failed response", async () => {
    const prompt = { requestId: "request-1", message: "Paste callback", promptType: "manual_code" } as const;
    const flow = oauthFlow({ prompt });
    const respondCalls: string[] = [];
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow, target: normalTarget(), inputValue: "https://callback" } },
      {
        respondOAuthFlow: (_flowId, _requestId, value) => {
          respondCalls.push(value);
          return respondCalls.length === 1 ? Promise.reject(new Error("Invalid callback")) : Promise.resolve(oauthFlow({ status: "complete" }));
        },
      },
    );

    await controller.respondOAuth();

    expect(getState().authDialog).toMatchObject({ step: "oauth", responding: false, error: "Error: Invalid callback" });

    await controller.respondOAuth();

    expect(respondCalls).toEqual(["https://callback", "https://callback"]);
    expect(getState().authDialog).toBeUndefined();
  });

  it("does not recreate an OAuth dialog when a pending response settles during cancellation", async () => {
    const prompt = { requestId: "request-1", message: "Paste callback", promptType: "manual_code" } as const;
    const flow = oauthFlow({ prompt });
    const response = deferred<OAuthFlowState>();
    const cancellation = deferred<OAuthFlowState>();
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow, target: normalTarget(), inputValue: "https://callback" } },
      {
        respondOAuthFlow: () => response.promise,
        cancelOAuthFlow: () => cancellation.promise,
      },
    );

    const responsePending = controller.respondOAuth();
    const cancellationPending = controller.cancelOAuth();
    const dialogAfterCancel = getState().authDialog;

    response.resolve(oauthFlow({ prompt, progress: ["Stale response"] }));
    await responsePending;
    const dialogAfterResponse = getState().authDialog;

    cancellation.resolve(oauthFlow({ status: "cancelled" }));
    await cancellationPending;

    expect(dialogAfterCancel).toBeUndefined();
    expect(dialogAfterResponse).toBeUndefined();
    expect(getState().authDialog).toBeUndefined();
  });

  it("best-effort cancels a running flow whose start response arrives after the dialog closes", async () => {
    const start = deferred<OAuthFlowState>();
    const provider: AuthProviderOption = { ...authProvider("amazon-bedrock", "api_key"), loginFlow: "interactive" };
    const cancelCalls: { flowId: string; machineId: string | undefined }[] = [];
    const { controller, getState } = createController(
      {
        selectedMachine: remoteMachine("remote-1"),
        authDialog: { step: "providers", mode: "login", target: remoteTarget("remote-1"), authType: "api_key", providers: [provider] },
      },
      {
        startInteractiveApiKeyLogin: () => start.promise,
        cancelOAuthFlow: (flowId, target) => {
          const machineId = target.machineId;
          cancelCalls.push({ flowId, machineId });
          return Promise.reject(new Error("Cancel unavailable"));
        },
      },
    );

    const pendingStart = controller.selectLoginProvider(provider.id, provider.authType);
    controller.closeDialog();
    start.resolve(oauthFlow({ flowId: "stale-flow", providerId: provider.id, providerName: provider.name }));
    await pendingStart;

    expect(cancelCalls).toEqual([{ flowId: "stale-flow", machineId: "remote-1" }]);
    expect(getState().authDialog).toBeUndefined();
    expect(getState().error).toBe("");
  });

  it("keeps prompt responses and cancellation bound to the flow's originating machine", async () => {
    const prompt = { requestId: "request-1", message: "Enter secret", promptType: "secret" } as const;
    const flow = oauthFlow({ providerId: "amazon-bedrock", prompt });
    const respondCalls: { value: string; machineId: string | undefined }[] = [];
    const cancelCalls: { flowId: string; machineId: string | undefined }[] = [];
    const { controller } = createController(
      {
        selectedMachine: remoteMachine("remote-2"),
        authDialog: { step: "oauth", flow, target: remoteTarget("remote-1"), inputValue: "secret-value" },
      },
      {
        respondOAuthFlow: (_flowId, _requestId, value, target) => {
          const machineId = target.machineId;
          respondCalls.push({ value, machineId });
          return Promise.resolve(flow);
        },
        cancelOAuthFlow: (flowId, target) => {
          const machineId = target.machineId;
          cancelCalls.push({ flowId, machineId });
          return Promise.resolve(oauthFlow({ status: "cancelled" }));
        },
      },
    );

    await controller.respondOAuth();
    await controller.cancelOAuth();

    expect(respondCalls).toEqual([{ value: "secret-value", machineId: "remote-1" }]);
    expect(cancelCalls).toEqual([{ flowId: "flow-1", machineId: "remote-1" }]);
  });

  it("keeps polling bound to the machine where an interactive flow started", async () => {
    let pollCallback: (() => void) | undefined;
    vi.stubGlobal("window", {
      setInterval: (callback: () => void) => {
        pollCallback = callback;
        return 1;
      },
      clearInterval: () => undefined,
    });
    const prompt = { requestId: "request-1", message: "Enter secret", promptType: "secret" } as const;
    const flow = oauthFlow({ providerId: "amazon-bedrock", prompt });
    const provider: AuthProviderOption = { ...authProvider("amazon-bedrock", "api_key"), loginFlow: "interactive" };
    const pollMachines: (string | undefined)[] = [];
    const { controller, getState, setState } = createController(
      {
        selectedMachine: remoteMachine("remote-1"),
        authDialog: { step: "providers", mode: "login", target: remoteTarget("remote-1"), authType: "api_key", providers: [provider] },
      },
      {
        startInteractiveApiKeyLogin: () => Promise.resolve(flow),
        oauthFlow: (_flowId, target) => {
          const machineId = target.machineId;
          pollMachines.push(machineId);
          return Promise.resolve(flow);
        },
      },
    );

    try {
      await controller.selectLoginProvider(provider.id, provider.authType);
      expect(getState().authDialog).toMatchObject({ step: "oauth", target: remoteTarget("remote-1") });

      setState({ selectedMachine: remoteMachine("remote-2") });
      if (pollCallback === undefined) throw new Error("Expected auth polling to start");
      pollCallback();
      await flushMicrotasks();

      expect(pollMachines).toEqual(["remote-1"]);
    } finally {
      controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("does not let a stale OAuth response overwrite a newer flow", async () => {
    vi.stubGlobal("window", { setInterval: () => 1, clearInterval: () => undefined });
    const oldPrompt = { requestId: "request-1", message: "Paste callback", promptType: "manual_code" } as const;
    const oldFlow = oauthFlow({ prompt: oldPrompt });
    const newFlow = oauthFlow({ flowId: "flow-2", prompt: { requestId: "request-2", message: "Paste callback", promptType: "manual_code" } });
    const response = deferred<OAuthFlowState>();
    const providers = [authProvider("anthropic", "oauth")];
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow: oldFlow, target: normalTarget(), inputValue: "https://old-callback" } },
      {
        respondOAuthFlow: () => response.promise,
        authProviders: () => Promise.resolve({ providers }),
        startOAuthLogin: () => Promise.resolve(newFlow),
      },
    );

    try {
      const responsePending = controller.respondOAuth();
      await controller.openLogin("anthropic");
      const dialogAfterNewFlow = getState().authDialog;

      response.resolve(oauthFlow({ prompt: oldPrompt, progress: ["Stale response"] }));
      await responsePending;

      expect(dialogAfterNewFlow).toMatchObject({ step: "oauth", flow: { flowId: "flow-2" } });
      expect(getState().authDialog).toMatchObject({ step: "oauth", flow: { flowId: "flow-2" } });
    } finally {
      response.resolve(oldFlow);
      controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("does not let an older poll restore a running flow after a newer poll stops polling", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
    const prompt = { requestId: "request-1", message: "Paste callback", promptType: "manual_code" } as const;
    const runningFlow = oauthFlow({ prompt });
    const stalePoll = deferred<OAuthFlowState>();
    const providers = [authProvider("anthropic", "oauth")];
    let pollCalls = 0;
    const { controller, getState } = createController(
      {},
      {
        authProviders: () => Promise.resolve({ providers }),
        startOAuthLogin: () => Promise.resolve(runningFlow),
        oauthFlow: () => {
          pollCalls += 1;
          return pollCalls === 1 ? stalePoll.promise : Promise.resolve(oauthFlow({ status: "cancelled", prompt }));
        },
      },
    );

    try {
      await controller.openLogin("anthropic");
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      const dialogAfterPollingStopped = getState().authDialog;

      stalePoll.resolve(oauthFlow({ prompt, progress: ["Stale running poll"] }));
      await flushMicrotasks();

      expect(pollCalls).toBe(2);
      expect(dialogAfterPollingStopped).toMatchObject({ step: "oauth", flow: { status: "cancelled" } });
      expect(getState().authDialog).toMatchObject({ step: "oauth", flow: { status: "cancelled" } });
    } finally {
      stalePoll.resolve(runningFlow);
      controller.dispose();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

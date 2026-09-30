// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiScope, type PromptAttachment, type SessionInfo, type SessionModel, type SessionStatus } from "../api";
import type { SessionDefaults } from "../../../shared/apiTypes";
import { initialAppState, type AppState } from "../appState";
import { SessionController } from "../controllers/sessionController";
import { PiWebApp } from "./PiWebApp";

beforeEach(() => {
  vi.spyOn(SessionController.prototype, "getSessionDefaults").mockResolvedValue(undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
  setApiScope("normal");
  vi.restoreAllMocks();
});

describe("PiWebApp model dialog", () => {
  it("does not apply an older default read to a reopened dialog", async () => {
    const app = new PiWebApp();
    const selectedSession = session("session-1");
    setAppState(app, { selectedSession, sessions: [selectedSession] });
    vi.spyOn(SessionController.prototype, "listModels").mockResolvedValue([]);
    vi.spyOn(SessionController.prototype, "listModelCatalog").mockResolvedValue([]);
    const pending = deferred<SessionDefaults | undefined>();
    vi.spyOn(SessionController.prototype, "getSessionDefaults")
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ defaultProvider: "openai", defaultModel: "new" });

    await callOpenModelDialog(app);
    await callOpenModelDialog(app);
    await vi.waitFor(() => { expect(appModelDialog(app)?.defaultValue).toBe("openai/new"); });
    pending.resolve({ defaultProvider: "openai", defaultModel: "old" });
    await pending.promise;

    expect(appModelDialog(app)?.defaultValue).toBe("openai/new");
  });

  it.each(["model", "thinking"] as const)("does not apply a pending %s pin to another session's dialog", async (kind) => {
    const app = new PiWebApp();
    const origin = { machineId: "local", sessionId: "session-1", cwd: "/repo" };
    const dialog = { instanceId: 1, origin, title: "选择", options: [], defaultValue: "previous" };
    setAppState(app, { selectedSession: session("session-1"), modelDialog: dialog, thinkingDialog: dialog });
    const pending = deferred<SessionDefaults>();
    const setDefaults = vi.spyOn(SessionController.prototype, "setSessionDefaults").mockReturnValue(pending.promise);
    const pin = callPinSessionDefault(app, kind, kind === "model" ? "openai/new" : "high");
    const replacement = { ...dialog, instanceId: 2, origin: { ...origin, sessionId: "session-2" } };
    setAppState(app, { selectedSession: session("session-2"), modelDialog: replacement, thinkingDialog: replacement });
    pending.resolve({ defaultProvider: "openai", defaultModel: "new", defaultThinkingLevel: "high" });
    await pin;

    expect(setDefaults).toHaveBeenCalledOnce();
    expect(appModelDialog(app)?.defaultValue).toBe("previous");
    expect(readAppState(app).thinkingDialog?.defaultValue).toBe("previous");
  });

  it("consumes message-action failures already reported by the controller", async () => {
    const app = new PiWebApp();
    const action = vi.spyOn(SessionController.prototype, "actOnMessage").mockRejectedValue(new Error("reported"));
    const handler: unknown = Reflect.get(app, "handleMessageAction");
    if (typeof handler !== "function") throw new Error("Message action boundary was unavailable");
    Reflect.apply(handler, app, ["entry-1", "fork"]);
    await vi.waitFor(() => { expect(action).toHaveBeenCalledWith("entry-1", "fork"); });
  });

  it.each(["/model", "/scoped-models"])("opens the existing model dialog for %s", async (command) => {
    const app = new PiWebApp();
    const selectedSession = session("session-1");
    setAppState(app, { selectedSession, sessions: [selectedSession] });
    vi.spyOn(SessionController.prototype, "listModels").mockResolvedValue([]);
    const catalog = [{ provider: "openai", id: "gpt-5", enabled: true }];
    vi.spyOn(SessionController.prototype, "listModelCatalog").mockResolvedValue(catalog);
    const send = vi.spyOn(SessionController.prototype, "send").mockResolvedValue(undefined);

    callSendPrompt(app, ` ${command} `);

    await vi.waitFor(() => { expect(appModelDialog(app)?.catalog).toEqual(catalog); });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["/model", "/scoped-models"])("keeps scope editing unavailable for %s in management embed", async (command) => {
    history.replaceState({}, "", "/?embed=management");
    const app = new PiWebApp();
    const selectedSession = session("session-1");
    setAppState(app, { selectedSession, sessions: [selectedSession] });
    vi.spyOn(SessionController.prototype, "listModels").mockResolvedValue([]);
    const catalog = vi.spyOn(SessionController.prototype, "listModelCatalog").mockResolvedValue([]);
    vi.spyOn(SessionController.prototype, "send").mockResolvedValue(undefined);

    callSendPrompt(app, command);

    await vi.waitFor(() => { expect(appModelDialog(app)).toBeDefined(); });
    expect(appModelDialog(app)?.catalog).toBeUndefined();
    expect(catalog).not.toHaveBeenCalled();
  });

  it("preserves delivery of model-like prompts and queued input", () => {
    const app = new PiWebApp();
    const send = vi.spyOn(SessionController.prototype, "send").mockResolvedValue(undefined);
    callSendPrompt(app, "/model other");
    callSendPrompt(app, "/model", "followUp");
    const attachments: PromptAttachment[] = [{ kind: "image", mimeType: "image/png", data: "AA==" }];
    callSendPrompt(app, "/scoped-models", undefined, attachments);
    expect(send).toHaveBeenNthCalledWith(1, "/model other", undefined, undefined, undefined, undefined);
    expect(send).toHaveBeenNthCalledWith(2, "/model", "followUp", undefined, undefined, undefined);
    expect(send).toHaveBeenNthCalledWith(3, "/scoped-models", undefined, attachments, undefined, undefined);
  });

  it("loads enabled options and the full catalog in normal mode", async () => {
    history.replaceState({}, "", "/");
    const app = new PiWebApp();
    const selectedSession = session("session-1");
    setAppState(app, {
      selectedSession,
      sessions: [selectedSession],
      status: sessionStatus(selectedSession.id, { provider: "openai", id: "gpt-5" }),
    });
    vi.spyOn(SessionController.prototype, "listModels")
      .mockResolvedValue([{ provider: "openai", id: "gpt-5" }, { provider: "anthropic", id: "claude-sonnet-4-5" }]);
    const catalog = [
      { provider: "openai", id: "gpt-5", enabled: true },
      { provider: "anthropic", id: "claude-sonnet-4-5", enabled: true },
      { provider: "openai", id: "gpt-4o", enabled: false },
    ];
    const listModelCatalog = vi.spyOn(SessionController.prototype, "listModelCatalog").mockResolvedValue(catalog);
    vi.spyOn(SessionController.prototype, "getSessionDefaults").mockResolvedValue(undefined);

    await callOpenModelDialog(app);
    await vi.waitFor(() => { expect(appModelDialog(app)?.defaultsLoading).toBe(false); });

    expect(listModelCatalog).toHaveBeenCalledOnce();
    expect(appModelDialog(app)).toEqual({
      instanceId: 1,
      origin: { machineId: "local", sessionId: selectedSession.id, cwd: selectedSession.cwd },
      title: "选择模型",
      selectedValue: "openai/gpt-5",
      options: [
        { value: "openai/gpt-5", label: "gpt-5 ✓ 当前", description: "openai" },
        { value: "anthropic/claude-sonnet-4-5", label: "claude-sonnet-4-5", description: "anthropic" },
      ],
      catalog,
      defaultsLoading: false,
    });
  });

  it("does not request or expose enabled-scope editing in management embed", async () => {
    history.replaceState({}, "", "/?embed=management");
    const app = new PiWebApp();
    const selectedSession = session("session-1");
    setAppState(app, { selectedSession, sessions: [selectedSession] });
    vi.spyOn(SessionController.prototype, "listModels").mockResolvedValue([{ provider: "openai", id: "gpt-5" }]);
    const listModelCatalog = vi.spyOn(SessionController.prototype, "listModelCatalog").mockRejectedValue(new Error("must not be called"));
    const setModelEnabled = vi.spyOn(SessionController.prototype, "setModelEnabled").mockRejectedValue(new Error("must not be called"));
    vi.spyOn(SessionController.prototype, "getSessionDefaults").mockResolvedValue(undefined);

    await callOpenModelDialog(app);
    await vi.waitFor(() => { expect(appModelDialog(app)?.defaultsLoading).toBe(false); });
    await callToggleHandler(app, "openai", "gpt-5", false);

    expect(listModelCatalog).not.toHaveBeenCalled();
    expect(setModelEnabled).not.toHaveBeenCalled();
    expect(appModelDialog(app)).toEqual({
      instanceId: 1,
      origin: { machineId: "local", sessionId: selectedSession.id, cwd: selectedSession.cwd },
      title: "选择模型",
      options: [{ value: "openai/gpt-5", label: "gpt-5", description: "openai" }],
      defaultsLoading: false,
    });
  });

  it("rebuilds enabled options from enabled catalog rows after a toggle", async () => {
    const app = new PiWebApp();
    const selectedSession = session("session-1");
    setAppState(app, {
      selectedSession,
      sessions: [selectedSession],
      status: sessionStatus(selectedSession.id, { provider: "openai", id: "gpt-5" }),
      modelDialog: {
        instanceId: 1,
        origin: { machineId: "local", sessionId: selectedSession.id, cwd: selectedSession.cwd },
        title: "选择模型",
        selectedValue: "openai/gpt-5",
        options: [{ value: "openai/gpt-5", label: "gpt-5 ✓ 当前", description: "openai" }],
        catalog: [{ provider: "openai", id: "gpt-5", enabled: true }],
      },
    });
    const freshCatalog = [
      { provider: "openai", id: "gpt-5", enabled: true },
      { provider: "openai", id: "gpt-4o", enabled: true },
      { provider: "anthropic", id: "claude-sonnet-4-5", enabled: false },
    ];
    vi.spyOn(SessionController.prototype, "setModelEnabled").mockResolvedValue(freshCatalog);

    await callToggleHandler(app, "openai", "gpt-4o", true);

    expect(appModelDialog(app)?.catalog).toEqual(freshCatalog);
    expect(appModelDialog(app)?.options).toEqual([
      { value: "openai/gpt-5", label: "gpt-5 ✓ 当前", description: "openai" },
      { value: "openai/gpt-4o", label: "gpt-4o", description: "openai" },
    ]);
  });

  it("applies an atomic model-scope preset to the originating dialog", async () => {
    const app = new PiWebApp();
    const selectedSession = session("session-1");
    setAppState(app, {
      selectedSession,
      sessions: [selectedSession],
      status: sessionStatus(selectedSession.id, { provider: "openai", id: "gpt-5" }),
      modelDialog: {
        instanceId: 1,
        origin: { machineId: "local", sessionId: selectedSession.id, cwd: selectedSession.cwd },
        title: "选择模型",
        selectedValue: "openai/gpt-5",
        options: [{ value: "openai/gpt-5", label: "gpt-5 ✓ 当前", description: "openai" }],
        catalog: [{ provider: "openai", id: "gpt-5", enabled: true }],
      },
    });
    const freshCatalog = [
      { provider: "openai", id: "gpt-5", enabled: true },
      { provider: "openai", id: "gpt-4o", enabled: false },
    ];
    const setModelScope = vi.spyOn(SessionController.prototype, "setModelScope").mockResolvedValue(freshCatalog);

    await callScopeHandler(app, "current");

    expect(setModelScope).toHaveBeenCalledWith("current");
    expect(appModelDialog(app)?.catalog).toEqual(freshCatalog);
  });
});

async function callOpenModelDialog(app: PiWebApp): Promise<void> {
  const method: unknown = Reflect.get(app, "openModelDialog");
  if (typeof method !== "function") throw new Error("PiWebApp openModelDialog was unavailable");
  await Reflect.apply(method, app, []);
}

async function callPinSessionDefault(app: PiWebApp, kind: "model" | "thinking", value: string): Promise<void> {
  const method: unknown = Reflect.get(app, "pinSessionDefault");
  if (typeof method !== "function") throw new Error("Session default boundary was unavailable");
  await Reflect.apply(method, app, [kind, value]);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => { throw new Error("Promise not initialized"); };
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function callSendPrompt(app: PiWebApp, text: string, streamingBehavior?: "followUp", attachments?: PromptAttachment[]): void {
  const handler: unknown = Reflect.get(app, "handleSendPrompt");
  if (typeof handler !== "function") throw new Error("PiWebApp send handler was unavailable");
  Reflect.apply(handler, app, [text, streamingBehavior, attachments]);
}

async function callToggleHandler(app: PiWebApp, provider: string, modelId: string, enabled: boolean): Promise<void> {
  const handler: unknown = Reflect.get(app, "handleToggleModelEnabled");
  if (typeof handler !== "function") throw new Error("PiWebApp model toggle handler was unavailable");
  await Reflect.apply(handler, app, [provider, modelId, enabled]);
}

async function callScopeHandler(app: PiWebApp, mode: "all" | "current"): Promise<void> {
  const handler: unknown = Reflect.get(app, "handleSetModelScope");
  if (typeof handler !== "function") throw new Error("PiWebApp model scope handler was unavailable");
  await Reflect.apply(handler, app, [mode]);
}

function appModelDialog(app: PiWebApp): AppState["modelDialog"] {
  return readAppState(app).modelDialog;
}

function readAppState(app: PiWebApp): AppState {
  const state: unknown = Reflect.get(app, "state");
  if (!isAppState(state)) throw new Error("PiWebApp state was unavailable");
  return state;
}

function isAppState(value: unknown): value is AppState {
  return typeof value === "object" && value !== null && "modelDialog" in value;
}

function setAppState(app: PiWebApp, patch: Partial<AppState>): void {
  if (!Reflect.set(app, "state", { ...initialAppState(), ...patch })) throw new Error("Could not set PiWebApp state");
}

function session(id: string): SessionInfo {
  return {
    id,
    cwd: "/repo",
    path: `/repo/${id}.jsonl`,
    created: "2026-08-21T00:00:00.000Z",
    modified: "2026-08-21T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
  };
}

function sessionStatus(sessionId: string, model?: SessionModel): SessionStatus {
  return {
    sessionId,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...(model === undefined ? {} : { model }),
  };
}

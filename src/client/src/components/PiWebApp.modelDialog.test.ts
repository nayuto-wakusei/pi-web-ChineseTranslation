// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiScope, type SessionInfo, type SessionModel, type SessionStatus } from "../api";
import { initialAppState, type AppState } from "../appState";
import { SessionController } from "../controllers/sessionController";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
  setApiScope("normal");
  vi.restoreAllMocks();
});

describe("PiWebApp model dialog", () => {
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

    await callOpenModelDialog(app);

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

    await callOpenModelDialog(app);
    await callToggleHandler(app, "openai", "gpt-5", false);

    expect(listModelCatalog).not.toHaveBeenCalled();
    expect(setModelEnabled).not.toHaveBeenCalled();
    expect(appModelDialog(app)).toEqual({
      instanceId: 1,
      origin: { machineId: "local", sessionId: selectedSession.id, cwd: selectedSession.cwd },
      title: "选择模型",
      options: [{ value: "openai/gpt-5", label: "gpt-5", description: "openai" }],
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
  const state: unknown = Reflect.get(app, "state");
  if (!isAppState(state)) throw new Error("PiWebApp state was unavailable");
  return state.modelDialog;
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

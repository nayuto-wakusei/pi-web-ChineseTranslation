// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionModel, SessionStatus } from "../api";
import { initialAppState, type AppState } from "../appState";
import { SessionController } from "../controllers/sessionController";
import { PiWebApp } from "./PiWebApp";

beforeEach(() => {
  vi.spyOn(SessionController.prototype, "getSessionDefaults").mockResolvedValue({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5", defaultThinkingLevel: "high" });
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const modelDialogOrigin = { machineId: "local", sessionId: "session-1", cwd: "/repo" } as const;

describe("PiWebApp model dialog", () => {
  it.each(["session", "model"] as const)("closes model and thinking dialogs when the %s changes", (change) => {
    const app = new PiWebApp();
    const selectedSession = session("session-1");
    const dialog = { instanceId: 1, origin: modelDialogOrigin, title: "Picker", options: [] };
    setAppState(app, {
      selectedSession, sessions: [selectedSession],
      status: sessionStatus(selectedSession.id, { provider: "openai", id: "gpt-5" }),
      modelDialog: dialog, thinkingDialog: dialog,
    });

    applyAppStatePatch(app, change === "session"
      ? { selectedSession: session("session-2") }
      : { status: sessionStatus(selectedSession.id, { provider: "anthropic", id: "claude-sonnet-4-5" }) });

    const state: unknown = Reflect.get(app, "state");
    if (!isAppState(state)) throw new Error("Missing app state");
    expect(state.modelDialog).toBeUndefined();
    expect(state.thinkingDialog).toBeUndefined();
  });

  it("refreshes an open dialog after a global model-scope change", async () => {
    const app = new PiWebApp();
    const selectedSession = session("session-1");
    setAppState(app, {
      selectedSession,
      sessions: [selectedSession],
      status: sessionStatus(selectedSession.id, { provider: "openai", id: "gpt-5" }),
      modelDialog: {
        instanceId: 1,
        origin: modelDialogOrigin,
        title: "Select Model",
        selectedValue: "openai/gpt-5",
        options: [{ value: "openai/gpt-5", label: "gpt-5 ✓ current", description: "openai" }],
        catalog: [{ provider: "openai", id: "gpt-5", enabled: true }],
      },
    });
    const listModels = vi.spyOn(SessionController.prototype, "listModels")
      .mockResolvedValue([{ provider: "openai", id: "gpt-5" }, { provider: "openai", id: "gpt-4o" }]);
    const listModelCatalog = vi.spyOn(SessionController.prototype, "listModelCatalog")
      .mockResolvedValue({ models: [
        { provider: "openai", id: "gpt-5", enabled: true },
        { provider: "openai", id: "gpt-4o", enabled: true },
      ] });
    const sessions: unknown = Reflect.get(app, "sessions");
    if (typeof sessions !== "object" || sessions === null) throw new Error("PiWebApp session controller was unavailable");
    const applyGlobalEvent: unknown = Reflect.get(sessions, "applyGlobalEvent");
    if (typeof applyGlobalEvent !== "function") throw new Error("SessionController global event handler was unavailable");

    Reflect.apply(applyGlobalEvent, sessions, [{ type: "models.changed", revision: 2 }]);
    await vi.waitFor(() => { expect(appModelDialog(app)?.options).toHaveLength(2); });

    expect(listModels).toHaveBeenCalledOnce();
    expect(listModelCatalog).toHaveBeenCalledOnce();
    expect(appModelDialog(app)?.options).toEqual([
      { value: "openai/gpt-5", label: "gpt-5 ✓ current", description: "openai" },
      { value: "openai/gpt-4o", label: "gpt-4o", description: "openai" },
    ]);
    expect(appModelDialog(app)?.catalog).toEqual([
      { provider: "openai", id: "gpt-5", enabled: true },
      { provider: "openai", id: "gpt-4o", enabled: true },
    ]);
  });

});

describe("startup default orchestration", () => {
  it("saves a model default without selecting it or closing the dialog", async () => {
    const app = new PiWebApp();
    const selectedSession = session("session-1");
    setAppState(app, { selectedSession, modelDialog: { instanceId: 1, origin: modelDialogOrigin, title: "Model", selectedValue: "openai/gpt-5", options: [], catalog: [] } });
    const save = vi.spyOn(SessionController.prototype, "setSessionDefaults").mockResolvedValue({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" });
    const select = vi.spyOn(SessionController.prototype, "setModel");
    await callDefaultHandler(app, "handleSetDefaultModel", "anthropic/claude-sonnet-4-5");
    expect(save).toHaveBeenCalledWith({ provider: "anthropic", modelId: "claude-sonnet-4-5" });
    expect(select).not.toHaveBeenCalled();
    expect(appModelDialog(app)).toMatchObject({ defaultValue: "anthropic/claude-sonnet-4-5", selectedValue: "openai/gpt-5" });
  });

  it("leaves the saved marker unchanged when saving fails", async () => {
    const app = new PiWebApp();
    setAppState(app, { selectedSession: session("session-1"), modelDialog: { instanceId: 1, origin: modelDialogOrigin, title: "Model", defaultValue: "openai/gpt-5", options: [], catalog: [] } });
    vi.spyOn(SessionController.prototype, "setSessionDefaults").mockResolvedValue(undefined);
    await callDefaultHandler(app, "handleSetDefaultModel", "anthropic/claude-sonnet-4-5");
    expect(appModelDialog(app)?.defaultValue).toBe("openai/gpt-5");
  });

  it("loads and pins thinking defaults independently of current thinking", async () => {
    const app = new PiWebApp();
    setAppState(app, { selectedSession: session("session-1"), status: { ...sessionStatus("session-1"), thinkingLevel: "low" } });
    vi.spyOn(SessionController.prototype, "listThinkingLevels").mockResolvedValue(["low", "high"]);
    await callAppMethod(app, "openThinkingDialog");
    const save = vi.spyOn(SessionController.prototype, "setSessionDefaults").mockResolvedValue({ defaultThinkingLevel: "high" });
    const select = vi.spyOn(SessionController.prototype, "setThinkingLevel");
    await callDefaultHandler(app, "handleSetDefaultThinking", "high");
    expect(save).toHaveBeenCalledWith({ thinkingLevel: "high" });
    expect(select).not.toHaveBeenCalled();
    const state: unknown = Reflect.get(app, "state");
    if (!isAppState(state)) throw new Error("Missing app state");
    expect(state.thinkingDialog).toMatchObject({ defaultValue: "high", selectedValue: "low" });
  });

  it("does not update a replacement model dialog after a save completes", async () => {
    const app = new PiWebApp();
    const selectedSession = session("session-1");
    setAppState(app, { selectedSession, modelDialog: { instanceId: 1, origin: modelDialogOrigin, title: "Model", options: [], catalog: [] } });
    let resolveSave: ((value: { defaultProvider: string; defaultModel: string }) => void) | undefined;
    vi.spyOn(SessionController.prototype, "setSessionDefaults").mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    const pending = callDefaultHandler(app, "handleSetDefaultModel", "openai/gpt-5");
    const replacement = { instanceId: 2, origin: modelDialogOrigin, title: "Replacement", options: [], catalog: [] };
    setAppState(app, { selectedSession, modelDialog: replacement });
    resolveSave?.({ defaultProvider: "openai", defaultModel: "gpt-5" });
    await pending;
    expect(appModelDialog(app)).toBe(replacement);
  });
});

async function callDefaultHandler(app: PiWebApp, name: "handleSetDefaultModel" | "handleSetDefaultThinking", value: string): Promise<void> {
  const handler: unknown = Reflect.get(app, name);
  if (typeof handler !== "function") throw new Error(`Missing ${name}`);
  await Reflect.apply(handler, app, [value]);
}

type AppModelDialog = AppState["modelDialog"];

async function callAppMethod(app: PiWebApp, name: "openModelDialog" | "openThinkingDialog"): Promise<void> {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`PiWebApp ${name} was unavailable`);
  await Reflect.apply(method, app, []);
}

function appModelDialog(app: PiWebApp): AppModelDialog {
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

function applyAppStatePatch(app: PiWebApp, patch: Partial<AppState>): void {
  const setState: unknown = Reflect.get(app, "setState");
  if (typeof setState !== "function") throw new Error("PiWebApp state updater was unavailable");
  Reflect.apply(setState, app, [patch]);
}

function session(id: string): SessionInfo {
  return {
    id,
    cwd: "/repo",
    path: `/repo/${id}.jsonl`,
    created: "2026-07-20T00:00:00.000Z",
    modified: "2026-07-20T00:00:00.000Z",
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

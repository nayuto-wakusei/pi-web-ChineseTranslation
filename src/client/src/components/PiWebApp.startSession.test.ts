// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import { api, type SessionInfo, type Workspace } from "../api";
import { PromptEditor } from "./PromptEditor";
import { PiWebApp } from "./PiWebApp";

const workspace: Workspace = {
  id: "workspace-1",
  projectId: "project-1",
  path: "/repo",
  label: "repo",
  effectiveConfig: {}, isMain: true,
  isGitRepo: true,
  isGitWorktree: false,
};

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

async function createApp(): Promise<PiWebApp> {
  window.history.replaceState({}, "", "/");
  const app = new PiWebApp();
  setState(app, {
    selectedProject: { id: "project-1", name: "Project", path: "/repo", createdAt: "now" },
    selectedWorkspace: workspace,
  });
  if (!Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true })) throw new Error("Could not bypass the auth gate");
  if (!Reflect.set(app, "normalAuthLoading", false)) throw new Error("Could not set auth loading state");
  if (!Reflect.set(app, "initializeNormalAuth", () => Promise.resolve())) throw new Error("Could not stub auth initialization");
  document.body.append(app);
  await app.updateComplete;
  return app;
}

function appState(app: PiWebApp): AppState {
  const value: unknown = Reflect.get(app, "state");
  if (!isAppState(value)) throw new Error("PiWebApp state was unavailable");
  return value;
}

function isAppState(value: unknown): value is AppState {
  return typeof value === "object" && value !== null && "browserErrors" in value;
}

function setState(app: PiWebApp, patch: Partial<AppState>): void {
  if (!Reflect.set(app, "state", { ...initialAppState(), ...patch })) throw new Error("Could not set PiWebApp state");
}

type StartSessionAndOpenChat = (this: PiWebApp) => Promise<void>;

function isStartSessionAndOpenChat(value: unknown): value is StartSessionAndOpenChat {
  return typeof value === "function";
}

function privateStartSessionAndOpenChat(app: PiWebApp): () => Promise<void> {
  const method: unknown = Reflect.get(app, "startSessionAndOpenChat");
  if (!isStartSessionAndOpenChat(method)) throw new Error("Session creation boundary was unavailable");
  return () => method.call(app);
}

function promptEditor(app: PiWebApp): PromptEditor {
  const element = app.shadowRoot?.querySelector("prompt-editor");
  if (!(element instanceof PromptEditor)) throw new Error("The selected session prompt editor was not rendered");
  return element;
}

describe("PiWebApp session creation focus", () => {
  it("focuses the prompt editor rendered for the pending session before creating it", async () => {
    const app = await createApp();
    const order: string[] = [];
    const pending = new Promise<SessionInfo>(() => undefined);
    const startSession = vi.spyOn(api, "startSession").mockImplementation(() => {
      order.push("create");
      return pending;
    });
    const originalFocus = Reflect.get(PromptEditor.prototype, "focusInput");
    if (typeof originalFocus !== "function") throw new Error("Prompt editor focus method was unavailable");
    let focusedSessionId: string | undefined;
    vi.spyOn(PromptEditor.prototype, "focusInput").mockImplementation(function (this: PromptEditor) {
      order.push("focus");
      focusedSessionId = this.sessionId;
      Reflect.apply(originalFocus, this, []);
    });

    await privateStartSessionAndOpenChat(app)();
    await vi.waitFor(() => { expect(startSession).toHaveBeenCalledOnce(); });

    const editor = promptEditor(app);
    await editor.updateComplete;
    expect(order).toEqual(["focus", "create"]);
    expect(focusedSessionId).toMatch(/^creating:/);
    expect(editor.sessionId).toBe(focusedSessionId);
    expect(editor.shadowRoot?.activeElement).toBe(editor.shadowRoot?.querySelector(".cm-content"));
  });

  it("cancels an unstarted session without overwriting a newer URL", async () => {
    const app = await createApp();
    const startSession = vi.spyOn(api, "startSession");
    const nextRoute = "/?machine=next-machine&project=next-project&workspace=next-workspace&session=next-session";
    if (!Reflect.set(app, "focusChatComposer", () => {
      expect(appState(app).selectedSession?.id).toMatch(/^creating:/);
      const sequence: unknown = Reflect.get(app, "navigationSelectionSeq");
      if (typeof sequence !== "number") throw new Error("Navigation sequence was unavailable");
      if (!Reflect.set(app, "navigationSelectionSeq", sequence + 1)) throw new Error("Could not cancel the old navigation");
      window.history.pushState({}, "", nextRoute);
      return Promise.resolve();
    })) throw new Error("Could not control composer focus");

    await privateStartSessionAndOpenChat(app)();
    await vi.waitFor(() => {
      expect(appState(app).selectedSession).toBeUndefined();
      expect(appState(app).sessions).toEqual([]);
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?machine=next-machine&project=next-project&workspace=next-workspace&session=next-session");
  });

  it("keeps a pending row available when focusing the new editor fails", async () => {
    const app = await createApp();
    const startSession = vi.spyOn(api, "startSession");
    if (!Reflect.set(app, "focusChatComposer", () => Promise.reject(new Error("focus failed")))) {
      throw new Error("Could not control composer focus");
    }

    await expect(privateStartSessionAndOpenChat(app)()).resolves.toBeUndefined();

    expect(startSession).not.toHaveBeenCalled();
    expect(appState(app).sessions).toHaveLength(1);
    expect(appState(app).sessions[0]?.id).toMatch(/^creating:/);
    expect(appState(app).activity).toMatchObject({ phase: "error", label: "会话创建失败" });
  });
});

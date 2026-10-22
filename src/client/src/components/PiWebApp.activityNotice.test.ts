// @vitest-environment happy-dom
import { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { SessionInfo, SessionStatus, SessionWarning } from "../api";
import { SessionController } from "../controllers/sessionController";
import { machineSessionKey } from "../machineKeys";
import { saveDraft } from "../promptDraftStorage";
import { clearStagedAttachments, saveStagedAttachments } from "../promptAttachmentStaging";
import { PromptEditor } from "./PromptEditor";
import { StatusBar } from "./StatusBar";
import { PiWebApp } from "./PiWebApp";
import { deepActiveElement } from "./modalLayerRegistry";
import { themeStylesheetFetch } from "./themeStylesheetFetch.testSupport";

class RenderOnlyApp extends PiWebApp {
  override connectedCallback(): void {
    LitElement.prototype.connectedCallback.call(this);
  }
}
customElements.define("activity-notice-test-app", RenderOnlyApp);

const session: SessionInfo = { id: "session", path: "/repo/session.jsonl", cwd: "/repo", name: "Current chat", created: "now", modified: "now", messageCount: 1, firstMessage: "hello" };
const unexpectedRequest = vi.fn(() => Promise.reject(new Error("Unexpected network request")));

beforeEach(() => {
  unexpectedRequest.mockClear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", themeStylesheetFetch(unexpectedRequest));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => {
  document.body.replaceChildren();
  clearStagedAttachments(machineSessionKey("local", session.id));
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(unexpectedRequest).not.toHaveBeenCalled();
});

describe("upstream external activity acknowledgement", () => {
it("keeps the activity notice in the blocked composer until dismissal without losing drafts or attachments", async () => {
    const send = vi.spyOn(SessionController.prototype, "send").mockResolvedValue(true);
    const key = machineSessionKey("local", session.id);
    saveDraft(key, "Unsent draft");
    saveStagedAttachments(key, [{ id: "file", kind: "file", name: "notes.txt", mimeType: "text/plain", data: "aGk=", size: 2 }]);
    const app = await mountApp({ selectedSession: session, status: sessionStatus(session.id) });
    await settle(app);
    const editor = promptEditor(app);
    expect(editor.disabled).toBe(false);

    patchState(app, { status: { ...sessionStatus(session.id, [{ severity: "warning", message: "Ordinary runtime warning" }]), recentlyActiveElsewhere: true } });
    await settle(app);
    const notice = app.shadowRoot?.querySelector(".composer-activity-notice");
    expect(notice?.getAttribute("role")).toBe("alert");
    expect(notice?.textContent).toContain("此会话最近在另一个 PI WEB 实例中活动");
    expect(notice?.parentElement).toBe(editor.parentElement);
    expect(editor.parentElement?.classList.contains("composer-area")).toBe(true);
    expect(notice?.previousElementSibling).toBe(editor);
    expect(editor.hasAttribute("inert")).toBe(true);
    expect(editor.disabled).toBe(true);
    expect(editor.view?.contentDOM.getAttribute("contenteditable")).toBe("false");
    const sendButton = editor.shadowRoot?.querySelector<HTMLButtonElement>(".send-button");
    expect(sendButton?.disabled).toBe(true);
    sendButton?.click();
    editor.view?.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, composed: true }));
    expect(send).not.toHaveBeenCalled();

    const chat = app.shadowRoot?.querySelector("chat-view");
    expect(chat?.hasAttribute("inert")).toBe(false);
    expect(chat?.shadowRoot?.textContent).not.toContain("此会话最近在另一个 PI WEB 实例中活动");
    expect(chat?.shadowRoot?.textContent).toContain("Ordinary runtime warning");
    const statusBar = app.shadowRoot?.querySelector<StatusBar>("status-bar");
    expect(statusBar?.warningCount).toBe(1);
    statusBar?.shadowRoot?.querySelector<HTMLButtonElement>(".warning-toggle")?.click();
    await settle(app);
    expect(chat?.shadowRoot?.textContent).not.toContain("Ordinary runtime warning");
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).toBe(notice);
    expect(editor.disabled).toBe(true);

    dismissActivityNotice(app);
    await settle(app);
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).toBeNull();
    expect(promptEditor(app)).toBe(editor);
    expect(editor.hasAttribute("inert")).toBe(false);
    expect(editor.disabled).toBe(false);
    expect(editor.view?.contentDOM.getAttribute("contenteditable")).toBe("true");
    expect(editor.view?.state.doc.toString()).toBe("Unsent draft");
    expect(editor.shadowRoot?.querySelector(".attachments")?.textContent).toContain("notes.txt");
    expect(deepActiveElement(document)).toBe(editor.view?.contentDOM);
    sendButton?.click();
    expect(send).toHaveBeenCalledOnce();
  });

it("scopes activity acknowledgement by machine/session and asks again after activity elsewhere clears", async () => {
    const status = { ...sessionStatus(session.id), recentlyActiveElsewhere: true };
    const app = await mountApp({ selectedSession: session, status });
    await settle(app);
    dismissActivityNotice(app);
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);

    expect(app.shadowRoot?.querySelector<StatusBar>("status-bar")?.warningCount).toBe(0);
    // Missing activity information, a stale session status, or unrelated warnings must not erase acknowledgement.
    patchState(app, { status: undefined });
    await settle(app);
    const missingActivityStatus: SessionStatus = { ...status };
    delete missingActivityStatus.recentlyActiveElsewhere;
    patchState(app, { status: missingActivityStatus });
    await settle(app);
    patchState(app, { status: sessionStatus("unrelated-session") });
    await settle(app);
    patchState(app, { status: { ...status, warnings: [{ severity: "warning", message: "New runtime warning" }] } });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);

    const otherSession = { ...session, id: "other-session" };
    patchState(app, { selectedSession: otherSession, status: { ...status, sessionId: otherSession.id } });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(true);
    patchState(app, { selectedSession: session, status });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);

    patchState(app, { selectedMachine: { id: "remote", name: "Remote", kind: "remote", baseUrl: "https://remote.test", createdAt: "now", updatedAt: "now" } });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(true);
    dismissActivityNotice(app);
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);
    patchState(app, { selectedMachine: undefined });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);

    patchState(app, { status: sessionStatus(session.id) });
    await settle(app);
    patchState(app, { status });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(true);
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).not.toBeNull();
  });

it("re-arms the notice when activity clears and resumes while another session is selected", async () => {
    const status = { ...sessionStatus(session.id), recentlyActiveElsewhere: true };
    const app = await mountApp({ selectedSession: session, status, sessionStatuses: { [session.id]: status } });
    await settle(app);
    dismissActivityNotice(app);
    await settle(app);

    const otherSession = { ...session, id: "other-session" };
    patchState(app, { selectedSession: otherSession, status: sessionStatus(otherSession.id) });
    await settle(app);
    patchState(app, { sessionStatuses: { [session.id]: sessionStatus(session.id) } });
    await settle(app);
    patchState(app, { sessionStatuses: { [session.id]: status } });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).toBeNull();

    patchState(app, { selectedSession: session, status });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(true);
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).not.toBeNull();
  });

it("does not re-enable archived sessions when the activity notice is dismissed", async () => {
    const app = await mountApp({ selectedSession: { ...session, archived: true }, status: { ...sessionStatus(session.id), recentlyActiveElsewhere: true } });
    await settle(app);
    dismissActivityNotice(app);
    await settle(app);
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).toBeNull();
    expect(promptEditor(app).disabled).toBe(true);
  });
});

async function mountApp(patch: Partial<AppState>): Promise<RenderOnlyApp> {
  const app = new RenderOnlyApp();
  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  Reflect.set(app, "state", { ...initialAppState(), ...patch });
  document.body.append(app);
  await app.updateComplete;
  return app;
}

function patchState(app: PiWebApp, patch: Partial<AppState>): void {
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null) throw new Error("Expected app state");
  Reflect.set(app, "state", { ...state, ...patch });
}

async function settle(element: LitElement): Promise<void> {
  await element.updateComplete;
  for (const child of element.shadowRoot?.querySelectorAll("*") ?? []) {
    if (child instanceof LitElement) await settle(child);
  }
  await element.updateComplete;
}

function sessionStatus(sessionId: string, warnings: SessionWarning[] = []): SessionStatus {
  return {
    sessionId, isStreaming: false, isCompacting: false, isBashRunning: false,
    recentlyActiveElsewhere: false,
    pendingMessageCount: 0, queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
    warnings,
  };
}

function promptEditor(app: PiWebApp): PromptEditor {
  const editor = app.shadowRoot?.querySelector("prompt-editor");
  if (!(editor instanceof PromptEditor)) throw new Error("Expected prompt editor");
  return editor;
}

function dismissActivityNotice(app: PiWebApp): void {
  const button = app.shadowRoot?.querySelector<HTMLButtonElement>(".composer-activity-notice button");
  if (button == null) throw new Error("Expected activity notice dismissal");
  expect(button.textContent).toBe("关闭提示并继续");
  button.click();
}

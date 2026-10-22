// @vitest-environment happy-dom
import { LitElement } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PI_WEB_CAPABILITIES } from "../../../shared/capabilities";
import { initialAppState, type AppState } from "../appState";
import type { SessionInfo, SessionStatus, Workspace } from "../api";
import { SessionController, type PromptEditorTextReplacement } from "../controllers/sessionController";
import { PluginRegistry } from "../plugins/registry";
import { setClientTranslations } from "../i18n";
import { PiWebApp } from "./PiWebApp";
import { ChatView } from "./ChatView";
import { PromptEditor } from "./PromptEditor";
import { ConversationLayout } from "./ConversationLayout";
import type { MessageActionAvailabilityContext, MessageActionResult } from "../../../plugin-api";
import type { QueuedMessageActionTarget } from "../queuedMessageActions";
import { themeStylesheetFetch } from "./themeStylesheetFetch.testSupport";

class ComposerQueueApp extends PiWebApp {
  override connectedCallback(): void { LitElement.prototype.connectedCallback.call(this); }
}
customElements.define("composer-queue-app", ComposerQueueApp);

const session: SessionInfo = { id: "s1", cwd: "/repo", path: "/repo/s1.jsonl", created: "now", modified: "now", messageCount: 0, firstMessage: "" };
const workspace: Workspace = { id: "w1", projectId: "p1", path: "/repo", label: "main", isMain: true, effectiveConfig: {} };
const status: SessionStatus = { sessionId: "s1", isStreaming: true, isCompacting: false, isBashRunning: false, pendingMessageCount: 1,
  queuedMessages: [{ kind: "steer", text: "queued" }], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
const apps: PiWebApp[] = [];
const unexpectedRequest = vi.fn(() => Promise.reject(new Error("Composer fixture must stay offline")));

beforeEach(() => {
  setClientTranslations("en", {});
  unexpectedRequest.mockClear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", themeStylesheetFetch(unexpectedRequest));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(async () => {
  document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear();
  for (const app of apps.splice(0)) {
    controller(app).dispose();
    const registry: unknown = Reflect.get(app, "plugins");
    if (registry instanceof PluginRegistry) await registry.dispose();
  }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); setClientTranslations("en", {});
  expect(unexpectedRequest).not.toHaveBeenCalled();
});

it("composes transcript, navigation, activity, status and gateway send preference without granting old runtimes actions", async () => {
  const app = await mount(false);
  const layout = app.shadowRoot?.querySelector("conversation-layout");
  const view = app.shadowRoot?.querySelector("chat-view");
  const editor = app.shadowRoot?.querySelector("prompt-editor");
  if (!(layout instanceof ConversationLayout) || !(view instanceof ChatView) || !(editor instanceof PromptEditor)) throw new Error("Missing composed conversation");
  expect(view.parentElement).toBe(layout);
  expect(editor.parentElement?.slot).toBe("composer");
  expect(app.shadowRoot?.querySelector("status-bar")?.slot).toBe("status");
  expect(layout.shadowRoot?.querySelector(".activity-dock")).not.toBeNull();
  expect(view.shadowRoot?.querySelector(".activity-dock")).toBeNull();
  expect(editor.chatNavigation).toBeDefined();
  expect(view.shadowRoot?.querySelector('[aria-label="Recall queued message"]')).toBeNull();
  expect(view.shadowRoot?.querySelector('[aria-label="Copy queued message"]')).not.toBeNull();
  const apply: unknown = Reflect.get(app, "applyClientConfig");
  if (typeof apply !== "function") throw new Error("Missing client config boundary");
  apply.call(app, { defaultStreamingBehavior: "followUp" });
  await settle(app);
  expect(editor.defaultStreamingBehavior).toBe("followUp");
  patch(app, { machineRuntimes: { local: { machineId: "local", ok: true, checkedAt: "now", capabilities: [PI_WEB_CAPABILITIES.sessionsQueueMessageActions] } } });
  await settle(app);
  expect(view.shadowRoot?.querySelector('[aria-label="Recall queued message"]')).not.toBeNull();
});

it("confirms draft replacement and releases the editor lock after recall completes", async () => {
  const app = await mount(true);
  const editor = app.shadowRoot?.querySelector("prompt-editor");
  const view = app.shadowRoot?.querySelector("chat-view");
  if (!(editor instanceof PromptEditor) || !(view instanceof ChatView)) throw new Error("Missing conversation children");
  editor.replaceText("unsent");
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  let complete: (() => void) | undefined;
  const mutation = vi.spyOn(controller(app), "mutateQueuedMessage").mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
  const recall = view.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="Recall queued message"]');
  if (recall === null || recall === undefined) throw new Error("Missing recall control");
  recall.click();
  expect(confirm).toHaveBeenCalledWith("Recalling will replace your unsent draft. Continue?");
  expect(mutation).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  recall.click();
  await vi.waitFor(() => { expect(mutation).toHaveBeenCalledExactlyOnceWith("edit", 0, status.queuedMessages); });
  await settle(app);
  expect(editor.disabled).toBe(true);
  expect(editor.inert).toBe(true);
  complete?.();
  await vi.waitFor(() => { expect(editor.disabled).toBe(false); });
  expect(editor.inert).toBe(false);
  expect(editor.view?.state.doc.toString()).toBe("unsent");
});

it("rechecks the callback guard after the shell update before replacing editor text", async () => {
  const app = await mount(true);
  const editor = app.shadowRoot?.querySelector("prompt-editor");
  if (!(editor instanceof PromptEditor)) throw new Error("Missing composer");
  editor.replaceText("current draft");
  const replace: unknown = Reflect.get(controller(app), "replacePromptEditorText");
  if (!isReplacement(replace)) throw new Error("Missing injected editor replacement");
  let current = true;
  const pending = replace({ machineId: "local", sessionId: "s1", text: "stale", isCurrent: () => current });
  current = false;
  await pending;
  expect(editor.view?.state.doc.toString()).toBe("current draft");
});

it("recalls without trying to lock a composer that is not mounted", async () => {
  const app = await unmounted();
  expect(Reflect.get(app, "promptEditor")).toBeNull();
  const mutation = vi.spyOn(controller(app), "mutateQueuedMessage").mockResolvedValue(undefined);
  const handle: unknown = Reflect.get(app, "handleQueuedMessageAction");
  if (!isQueueHandler(handle)) throw new Error("Missing queue handler");
  await handle({ machineId: "local", sessionId: session.id, cwd: session.cwd, action: "edit", index: 0, expectedQueue: status.queuedMessages });
  expect(mutation).toHaveBeenCalledExactlyOnceWith("edit", 0, status.queuedMessages);
  expect(Reflect.get(app, "queuedMessageActionTarget")).toBeUndefined();
});

it("allows a scoped plugin history action when its composer is not mounted", async () => {
  const app = await unmounted();
  const registry: unknown = Reflect.get(app, "plugins");
  const context: unknown = Reflect.get(app, "messageActionContext");
  const handle: unknown = Reflect.get(app, "handleMessageAction");
  if (!(registry instanceof PluginRegistry) || !isContextGetter(context) || !isMessageHandler(handle)) throw new Error("Missing message-action boundary");
  Reflect.set(app, "verifiedPluginModeByMachine", new Map([["local", "recovery-disabled"]]));
  await registry.register({ id: "unmounted-history", plugin: { apiVersion: 5, name: "History", activate: () => ({ contributions: {
    messageActions: [{ id: "back", title: "Go back", run: (input) => input.history.goBack() }],
  } }) } });
  const state: AppState = { ...initialAppState(), selectedSession: session, messages: [{ role: "user", entryId: "entry-1", parts: [{ type: "text", text: "hello" }] }] };
  Reflect.set(app, "state", state);
  const input = context.call(app, state);
  if (input === undefined) throw new Error("Missing scoped action context");
  const history = vi.spyOn(controller(app), "actOnMessage").mockResolvedValue(undefined);
  await handle({ ...input, message: { entryId: "entry-1", role: "user", text: "hello" } }, "unmounted-history:back");
  expect(history).toHaveBeenCalledExactlyOnceWith("entry-1", "back");
  expect(Reflect.get(app, "messageRevertTarget")).toBeUndefined();
});

function controller(app: PiWebApp): SessionController {
  const value: unknown = Reflect.get(app, "sessions");
  if (!(value instanceof SessionController)) throw new Error("Missing session controller");
  return value;
}
function isReplacement(value: unknown): value is (replacement: PromptEditorTextReplacement) => Promise<void> { return typeof value === "function"; }
function isQueueHandler(value: unknown): value is (target: QueuedMessageActionTarget) => Promise<void> { return typeof value === "function"; }
function isMessageHandler(value: unknown): value is (target: MessageActionAvailabilityContext, actionId: string) => Promise<MessageActionResult> { return typeof value === "function"; }
function isContextGetter(value: unknown): value is (this: PiWebApp, state: AppState) => Omit<MessageActionAvailabilityContext, "message"> | undefined { return typeof value === "function"; }
function patch(app: PiWebApp, changes: Partial<AppState>): void {
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null) throw new Error("Missing app state");
  Reflect.set(app, "state", { ...state, ...changes });
}
async function mount(supported: boolean): Promise<PiWebApp> {
  const app = new ComposerQueueApp(); apps.push(app);
  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  Reflect.set(app, "normalAuthLoading", false);
  Reflect.set(app, "state", { ...initialAppState(), selectedWorkspace: workspace, selectedSession: session, status,
    machineRuntimes: { local: { machineId: "local", ok: true, checkedAt: "now", capabilities: supported ? [PI_WEB_CAPABILITIES.sessionsQueueMessageActions] : [] } },
  });
  await Reflect.get(app, "builtInPluginsReady");
  document.body.append(app);
  await settle(app);
  return app;
}
async function unmounted(): Promise<PiWebApp> {
  const app = new PiWebApp(); apps.push(app);
  Reflect.set(app, "state", { ...initialAppState(), selectedSession: session, status,
    machineRuntimes: { local: { machineId: "local", ok: true, checkedAt: "now", capabilities: [PI_WEB_CAPABILITIES.sessionsQueueMessageActions] } },
  });
  await Reflect.get(app, "builtInPluginsReady");
  return app;
}
async function settle(element: LitElement): Promise<void> {
  await element.updateComplete;
  for (const child of element.shadowRoot?.querySelectorAll("*") ?? []) if (child instanceof LitElement) await settle(child);
  await element.updateComplete;
}

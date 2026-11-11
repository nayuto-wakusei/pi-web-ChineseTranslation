// @vitest-environment happy-dom
import { LitElement } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { SessionInfo } from "../api";
import { machineSessionKey } from "../machineKeys";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { deepActiveElement } from "./modalLayerRegistry";
import { PiWebApp } from "./PiWebApp";

const editorModule = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release, requested: vi.fn() };
});
vi.mock("./PromptEditor", async (importOriginal) => {
  editorModule.requested();
  await editorModule.gate;
  return importOriginal();
});

class DeferredComposerApp extends PiWebApp {
  override connectedCallback(): void { LitElement.prototype.connectedCallback.call(this); }
}
customElements.define("deferred-composer-test-app", DeferredComposerApp);

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

it("waits for a conversation, renders history during the download, and mounts only the current draft without stealing focus", async () => {
  const app = new DeferredComposerApp();
  const outside = document.createElement("button");
  document.body.append(app, outside);
  await app.updateComplete;
  expect(editorModule.requested).not.toHaveBeenCalled();

  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  await app.updateComplete;
  expect(editorModule.requested).not.toHaveBeenCalled();

  const first = session("first");
  const second = session("second");
  saveDraft(machineSessionKey("local", first.id), "First draft");
  saveDraft(machineSessionKey("local", second.id), "Second draft");
  select(app, first);
  await vi.waitFor(() => {
    expect(editorModule.requested).toHaveBeenCalledOnce();
    expect(app.shadowRoot?.querySelector("chat-view")).not.toBeNull();
    expect(app.shadowRoot?.querySelector("prompt-editor")).toBeNull();
  });
  const focus: unknown = Reflect.get(app, "openChatAndFocusComposer");
  if (typeof focus !== "function") throw new Error("Missing chat focus action");
  const obsoleteFocus: unknown = Reflect.apply(focus, app, []);
  select(app, second);
  await app.updateComplete;
  outside.focus();
  editorModule.release();
  await obsoleteFocus;

  const input = () => app.shadowRoot?.querySelector("prompt-editor")?.shadowRoot?.querySelector(".cm-content");
  await vi.waitFor(() => { expect(input()?.textContent).toBe("Second draft"); });
  expect(deepActiveElement(document)).toBe(outside);
  expect(loadDraft(machineSessionKey("local", first.id))).toBe("First draft");

  await Reflect.apply(focus, app, []);
  expect(deepActiveElement(document)).toBe(input());
});

function session(id: string): SessionInfo {
  return { id, path: `/repo/${id}.jsonl`, cwd: "/repo", created: "now", modified: "now", messageCount: 1, firstMessage: id };
}

function select(app: PiWebApp, selectedSession: SessionInfo): void {
  const state: AppState = {
    ...initialAppState(), mainView: "chat", selectedSession, messagePageEnd: 1, messagePageTotal: 1,
    messages: [{ role: "user", parts: [{ type: "text", text: selectedSession.firstMessage }] }],
  };
  Reflect.set(app, "state", state);
}

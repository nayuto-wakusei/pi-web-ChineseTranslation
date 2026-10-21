// @vitest-environment happy-dom
import { render, type TemplateResult } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import type { MessageActionContext } from "../../../plugin-api";
import type { SessionInfo } from "../api";
import { initialAppState, type AppState } from "../appState";
import { SessionController } from "../controllers/sessionController";
import { PluginRegistry } from "../plugins/registry";
import { ChatView } from "./ChatView";
import { PiWebApp } from "./PiWebApp";

const session: SessionInfo = {
  id: "session-1", cwd: "/repo", path: "/repo/session.jsonl", created: "now", modified: "now", messageCount: 1, firstMessage: "Hello",
};
const apps: PiWebApp[] = [];

afterEach(async () => {
  document.body.replaceChildren();
  localStorage.clear();
  for (const app of apps.splice(0)) {
    const controller: unknown = Reflect.get(app, "sessions");
    if (controller instanceof SessionController) controller.dispose();
    const registry: unknown = Reflect.get(app, "plugins");
    if (registry instanceof PluginRegistry) await registry.dispose();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("connects public plugin callbacks and core history actions to the app's scoped helpers", async () => {
  // Use the real chat render seam without mounting the shell's unrelated
  // network/session lifecycles; interactions still use actual DOM buttons.
  const app = new PiWebApp();
  apps.push(app);
  await Reflect.get(app, "builtInPluginsReady");
  const registry: unknown = Reflect.get(app, "plugins");
  const controller: unknown = Reflect.get(app, "sessions");
  const modes: unknown = Reflect.get(app, "verifiedPluginModeByMachine");
  const renderChat: unknown = Reflect.get(app, "renderChatView");
  if (!(registry instanceof PluginRegistry) || !(controller instanceof SessionController) || !(modes instanceof Map) || !isRenderChat(renderChat)) {
    throw new Error("Expected app chat collaborators");
  }
  modes.set("local", "recovery-disabled");
  const state: AppState = { ...initialAppState(), selectedSession: session, messages: [
    { role: "user", entryId: "entry-1", parts: [{ type: "text", text: "Hello" }] },
  ] };
  Reflect.set(app, "state", state);
  const history = vi.spyOn(controller, "actOnMessage").mockResolvedValue(undefined);
  let received: MessageActionContext | undefined;
  await registry.register({ id: "notes", plugin: {
    apiVersion: 4, name: "Notes", activate: () => ({ contributions: { messageActions: [{
      id: "note", title: "Save note", run: (context) => { received = context; context.prompt.setChip?.({ id: "note", label: "Note", text: context.message.text }); },
    }] } }),
  } });
  const container = document.createElement("div");
  document.body.append(container);
  render(renderChat.call(app, state, session), container);
  const view = container.querySelector<ChatView>("chat-view");
  if (view === null) throw new Error("Expected chat view");
  await view.updateComplete;
  const confirm = vi.fn(() => true);
  vi.stubGlobal("confirm", confirm);
  click(view, "Save note");
  await view.updateComplete;
  await vi.waitFor(() => { expect(actionButton(view, "Save note").disabled).toBe(false); });
  expect(confirm).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
  expect(received).toMatchObject({ machine: { id: "local" }, session: { id: session.id }, message: { entryId: "entry-1", text: "Hello", role: "user" } });
  expect(received).not.toHaveProperty("state");
  expect(received?.session).not.toHaveProperty("path");
  expect(registry.promptChips.list({ machineId: "local", cwd: session.cwd, sessionId: session.id })).toMatchObject([{ label: "Note", text: "Hello" }]);
  click(view, "分叉");
  await vi.waitFor(() => { expect(history).toHaveBeenLastCalledWith("entry-1", "fork"); });
  await vi.waitFor(() => { expect(actionButton(view, "回退").disabled).toBe(false); });
  click(view, "回退");
  await vi.waitFor(() => { expect(history).toHaveBeenLastCalledWith("entry-1", "back"); });

  Reflect.set(app, "state", { ...state, selectedSession: { ...session, id: "other" } });
  await expect(received?.history.fork()).rejects.toThrow("no longer available");
  expect(history).toHaveBeenCalledTimes(2);
  expect(received?.prompt.getText()).toBe("");
  // Chips remain bound to the initiating conversation even after selection changes.
  received?.prompt.setChip?.({ id: "note", label: "Later", text: "Captured" });
  expect(registry.promptChips.list({ machineId: "local", cwd: session.cwd, sessionId: "other" })).toEqual([]);
  expect(registry.promptChips.list({ machineId: "local", cwd: session.cwd, sessionId: session.id })).toMatchObject([{ label: "Later" }]);
});

function click(view: ChatView, label: string) {
  actionButton(view, label).click();
}

function actionButton(view: ChatView, label: string): HTMLButtonElement {
  const button = Array.from(view.renderRoot.querySelectorAll<HTMLButtonElement>(".msg-action")).find((button) => button.getAttribute("aria-label") === label);
  if (button === undefined) throw new Error(`Expected ${label} button`);
  return button;
}

function isRenderChat(value: unknown): value is (this: PiWebApp, state: AppState, session: SessionInfo) => TemplateResult {
  return typeof value === "function";
}

// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DisplayedMessageActionAvailabilityContext, DisplayedMessageActionContext, DisplayedMessageActionContribution, MessageActionAvailabilityContext, MessageActionContext, MessageActionContribution } from "../../../plugin-api";
import { normalizeMessages } from "../chatMessages";
import { corePlugin } from "../plugins/core";
import { PluginRegistry } from "../plugins/registry";
import { setClientTranslations } from "../i18n";
import type { FormattedText } from "./FormattedText";
import { ChatView } from "./ChatView";

beforeEach(() => { setClientTranslations("en", {}); });
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const base = {
  machine: { id: "local", name: "Local", kind: "local" },
  session: { id: "session-1", cwd: "/repo", archived: false, pending: false, busy: false },
} as const;

function invocation(input: MessageActionAvailabilityContext): MessageActionContext {
  return {
    ...input,
    prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null },
    navigate: vi.fn(),
    projects: { machineId: "local", listProjects: vi.fn(), suggestDirectories: vi.fn() },
    history: { fork: vi.fn(), goBack: vi.fn() },
  };
}

async function mount(contributions?: MessageActionContribution[]) {
  const registry = new PluginRegistry();
  await registry.register({ id: "core", plugin: corePlugin });
  if (contributions !== undefined) await registry.register({ id: "custom", plugin: {
    apiVersion: 4, name: "Custom", activate: () => ({ contributions: { messageActions: contributions } }),
  } });
  const view = new ChatView();
  view.sessionId = base.session.id;
  view.messages = [{ role: "user", entryId: "entry-1", parts: [{ type: "text", text: "Hello" }] }];
  view.messageActionContext = base;
  view.messageActions = registry.getMessageActions("local");
  const context = invocation({ ...base, message: { entryId: "entry-1", role: "user", text: "Hello" } });
  view.onMessageAction = (input, id) => registry.runMessageAction(id, input, () => context);
  view.onDisplayedMessageAction = (input, id) => registry.runDisplayedMessageAction(id, input, () => displayedInvocation(input));
  document.body.append(view);
  await view.updateComplete;
  return { view, registry, context };
}

function displayedInvocation(input: DisplayedMessageActionAvailabilityContext): DisplayedMessageActionContext {
  return {
    ...input,
    prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null },
    navigate: vi.fn(),
    projects: { machineId: "local", listProjects: vi.fn(), suggestDirectories: vi.fn() },
  };
}

function button(view: ChatView, label: string): HTMLButtonElement {
  const result = buttons(view).find((button) => button.getAttribute("aria-label") === label || button.title === label);
  if (result === undefined) throw new Error(`Missing message action ${label}`);
  return result;
}

function buttons(view: ChatView) {
  return Array.from(view.renderRoot.querySelectorAll<HTMLButtonElement>(".msg-action"));
}

async function settle(view: ChatView) {
  await view.updateComplete;
  await view.updateComplete;
}

  it("renders whole-entry history only on the reply while display plugins remain on shared thinking/reply headers", async () => {
    const displayRun = vi.fn<DisplayedMessageActionContribution["run"]>();
    const { view } = await mount([{ target: "display", id: "inspect", title: "Inspect slice", run: displayRun }]);
    const onHistory = vi.fn(() => Promise.resolve());
    view.onMessageAction = onHistory;
    view.messageStart = 20;
    view.messages = normalizeMessages([{ role: "assistant", entryId: "assistant-8", content: [
      { type: "thinking", thinking: "Considering user testing messages" },
      { type: "text", text: "Test message 8/10" },
    ] }]);
    await settle(view);
    const group = view.renderRoot.querySelector<HTMLDetailsElement>("details.event-group");
    if (group === null) throw new Error("Missing thinking event group");
    expect(group.open).toBe(false);
    group.open = true;
    group.dispatchEvent(new Event("toggle"));
    await settle(view);

    const thinking = group.querySelector<HTMLElement>("section.group-msg.assistant");
    const reply = view.renderRoot.querySelector<HTMLElement>("article.msg.assistant");
    if (thinking === null || reply === null) throw new Error("Missing shared-entry slices");
    const formatted = [thinking, reply].map((slice) => {
      const element = slice.querySelector<FormattedText>("formatted-text");
      if (element === null) throw new Error("Missing slice text");
      return element;
    });
    await Promise.all(formatted.map((element) => element.updateComplete));
    expect(formatted.map((element) => element.renderRoot.textContent)).toEqual([
      expect.stringContaining("Considering user testing messages"), expect.stringContaining("Test message 8/10"),
    ]);
    expect(Array.from(thinking.querySelectorAll<HTMLButtonElement>(".msg-action"), (action) => action.title)).toEqual(["Inspect slice"]);
    expect(Array.from(reply.querySelectorAll<HTMLButtonElement>(".msg-action"), (action) => action.title)).toEqual([
      "Clone session from this message", "Go back to this message", "Copy message", "Inspect slice",
    ]);
    for (const label of ["Fork", "Go back to this message"]) {
      expect(buttons(view).filter((action) => action.getAttribute("aria-label") === label)).toHaveLength(1);
    }

    const displayButtons = buttons(view).filter((action) => action.title === "Inspect slice");
    for (const action of displayButtons) {
      action.click();
      await settle(view);
    }
    expect(displayRun.mock.calls.map(([context]) => context.message)).toEqual([
      { entryId: "assistant-8", role: "assistant", text: "" },
      { entryId: "assistant-8", role: "assistant", text: "Test message 8/10" },
    ]);
    const fork = view.messageActions.find((action) => action.title === "Clone session from this message");
    if (fork === undefined) throw new Error("Missing history contribution");
    button(view, fork.title).click();
    await settle(view);
    expect(onHistory).toHaveBeenCalledExactlyOnceWith({
      ...base, message: { entryId: "assistant-8", role: "assistant", text: "Test message 8/10" },
    }, fork.id);
  });

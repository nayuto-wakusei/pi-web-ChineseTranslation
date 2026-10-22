// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DisplayedMessageActionAvailabilityContext, DisplayedMessageActionContext, EntryMessageActionContribution, MessageActionAvailabilityContext, MessageActionContext, MessageActionContribution, MessageActionFeedback } from "../../../plugin-api";
import { normalizeMessages } from "../chatMessages";
import * as clipboard from "../clipboard";
import { corePlugin } from "../plugins/core";
import { PluginRegistry } from "../plugins/registry";
import type { ChatLine } from "./shared";
import { ChatView } from "./ChatView";

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

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
  const result = buttons(view).find((button) => button.getAttribute("aria-label") === label);
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

describe("plugin-defined transcript message actions", () => {
  it.each([
    ["分叉", "fork", "从这条消息分叉出一个新会话？当前会话保持不变。"],
    ["回退", "goBack", "回退到这条消息？之后的对话会离开当前分支，未保存的输入不会保留。"],
  ] as const)("preserves core confirmation for %s through the public callback", async (label, action, copy) => {
    const { view, context } = await mount();
    expect(buttons(view).map((button) => button.getAttribute("aria-label"))).toEqual([
      "分叉", "回退", "复制用户消息",
    ]);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    button(view, label).click();
    await settle(view);
    expect(confirm).toHaveBeenCalledWith(copy);
    expect(context.history[action]).not.toHaveBeenCalled();
    await vi.waitFor(() => { expect(button(view, label).disabled).toBe(false); });
    confirm.mockReturnValue(true);
    button(view, label).click();
    await settle(view);
    await vi.waitFor(() => { expect(context.history[action]).toHaveBeenCalledOnce(); });
  });

  it("runs arbitrary plugin workflows without a host confirmation and filters availability per message", async () => {
    const run = vi.fn<EntryMessageActionContribution["run"]>();
    const { view, context } = await mount([
      { id: "quote", title: "Quote", visible: ({ message }) => message.role === "user", enabled: ({ message }) => message.text !== "Blocked", run },
      { id: "hidden", title: "Hidden", visible: () => false, run },
    ]);
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    button(view, "Quote").click();
    await settle(view);
    expect(run).toHaveBeenCalledExactlyOnceWith(context);
    expect(confirm).not.toHaveBeenCalled();
    expect(buttons(view).some((button) => button.title === "Hidden")).toBe(false);
    view.messages = [{ role: "user", entryId: "entry-2", parts: [{ type: "text", text: "Blocked" }] }];
    await settle(view);
    expect(button(view, "Quote").disabled).toBe(true);
    view.messages = [{ role: "assistant", entryId: "entry-3", parts: [{ type: "text", text: "Answer" }] }];
    await settle(view);
    expect(buttons(view).some((button) => button.title === "Quote")).toBe(false);
  });

  it("uses original message identities and displayed roles across paginated skill headers", async () => {
    const { view } = await mount([{ id: "skill", title: "Inspect skill", visible: ({ message }) => message.role === "skill", run: () => undefined }]);
    view.messageStart = 20;
    view.messages = [{ role: "assistant", entryId: "skill-entry", parts: [{ type: "skillRead", name: "example", path: "/skills/example/SKILL.md" }] }];
    view.onMessageAction = vi.fn(() => Promise.resolve());
    await settle(view);
    const group = view.renderRoot.querySelector<HTMLDetailsElement>("details.event-group");
    if (group === null) throw new Error("Missing skill activity");
    expect(group.open).toBe(false);
    group.open = true;
    group.dispatchEvent(new Event("toggle"));
    await settle(view);
    expect(buttons(view).map((button) => button.title)).toEqual(["Inspect skill"]);
    button(view, "Inspect skill").click();
    await settle(view);
    expect(view.onMessageAction).toHaveBeenCalledWith({ ...base, message: { entryId: "skill-entry", role: "skill", text: "" } }, "custom:skill");
  });

  it("offers only opted-in display actions without a durable entry", async () => {
    const { view } = await mount();
    view.messages = [{ role: "assistant", parts: [{ type: "text", text: "Streaming" }] }];
    await view.updateComplete;
    expect(buttons(view).map((button) => button.title)).toEqual(["复制消息"]);
  });

  it("copies through the plugin registry, preserves original text and renews transient feedback", async () => {
    vi.useFakeTimers();
    const writeText = vi.spyOn(clipboard, "writeClipboardText").mockResolvedValue(true);
    const { view } = await mount();
    view.messages = [{ role: "assistant", parts: [
      { type: "thinking", text: "Private reasoning" },
      Object.assign({ type: "text" as const, text: "  First  " }, { displayText: "Displayed differently" }),
      { type: "text", text: "   " },
      { type: "text", text: " Second\n" },
    ] }];
    await settle(view);
    expect(buttons(view).map((button) => button.title)).toEqual(["复制消息"]);
    button(view, "复制助手消息").click();
    await settle(view);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("First\n\nSecond");
    await vi.waitFor(() => { expect(button(view, "已复制助手消息").title).toBe("已复制"); });
    expect(button(view, "已复制助手消息").textContent).toContain("✓");
    await vi.advanceTimersByTimeAsync(800);
    button(view, "已复制助手消息").click();
    await vi.waitFor(() => { expect(button(view, "已复制助手消息").disabled).toBe(false); });
    await vi.advanceTimersByTimeAsync(800);
    expect(button(view, "已复制助手消息").title).toBe("已复制");
    await vi.advanceTimersByTimeAsync(400);
    await settle(view);
    expect(button(view, "复制助手消息").title).toBe("复制消息");
  });

  it("has no built-in Copy fallback when the contribution is absent", async () => {
    const { view } = await mount();
    view.messageActions = view.messageActions.filter((action) => action.id !== "core:message.copy");
    await settle(view);
    expect(buttons(view).map((button) => button.title)).toEqual(["从这条消息分叉", "回退到这条消息"]);
  });

  it("lets Copy run while an entry workflow is pending and reports clipboard failure without success feedback", async () => {
    const writeText = vi.spyOn(clipboard, "writeClipboardText").mockResolvedValue(false);
    const { view } = await mount();
    let finish: (() => void) | undefined;
    view.onMessageAction = () => new Promise<void>((resolve) => { finish = resolve; });
    button(view, "回退").click();
    await settle(view);
    expect(button(view, "回退").disabled).toBe(true);
    expect(button(view, "复制用户消息").disabled).toBe(false);
    button(view, "复制用户消息").click();
    await settle(view);
    expect(writeText).toHaveBeenCalledWith("Hello");
    expect(button(view, "复制用户消息").title).toBe("复制消息");
    await vi.waitFor(() => { expect(view.renderRoot.querySelector('[role="alert"]')?.textContent).toBe("无法复制消息到剪贴板。"); });
    finish?.();
    await settle(view);
  });

  it("shows generic plugin feedback only at its originating display target and clears it on selection/disconnect", async () => {
    vi.useFakeTimers();
    const { view } = await mount([{ target: "display", id: "mark", title: "Mark", run: () => ({ title: "Marked" }) }]);
    view.messages = [
      { role: "user", entryId: "shared", parts: [{ type: "text", text: "One" }] },
      { role: "user", entryId: "shared", parts: [{ type: "text", text: "Two" }] },
    ];
    await settle(view);
    button(view, "Mark").click();
    await settle(view);
    expect(buttons(view).filter((button) => button.title === "Marked")).toHaveLength(1);
    expect(buttons(view).filter((button) => button.title === "Mark")).toHaveLength(1);
    view.machineId = "remote";
    await settle(view);
    expect(buttons(view).filter((button) => button.title === "Marked")).toHaveLength(0);
    button(view, "Mark").click();
    await settle(view);
    view.remove();
    document.body.append(view);
    await settle(view);
    expect(buttons(view).filter((button) => button.title === "Marked")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1200);
    await settle(view);
  });

  it.each(["selection", "remount"])("ignores late plugin feedback after %s retires the invocation", async (change) => {
    const { view } = await mount([{ target: "display", id: "save", title: "Save", run: () => undefined }]);
    let finish: ((feedback: MessageActionFeedback) => void) | undefined;
    const result = new Promise<MessageActionFeedback>((resolve) => { finish = resolve; });
    view.onDisplayedMessageAction = () => result;
    button(view, "Save").click();
    await settle(view);
    if (change === "selection") {
      view.sessionId = "other";
      await settle(view);
      view.sessionId = base.session.id;
    } else {
      view.remove();
      document.body.append(view);
    }
    await settle(view);
    finish?.({ title: "Saved" });
    await result;
    await settle(view);
    expect(buttons(view).some((button) => button.title === "Saved")).toBe(false);
    expect(button(view, "Save").disabled).toBe(false);
  });

  it("disables core history actions while busy but leaves Copy and other plugin policy independent", async () => {
    const { view } = await mount([{ id: "note", title: "Note", run: () => undefined }]);
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    view.messageActionContext = { ...base, session: { ...base.session, busy: true } };
    await settle(view);
    button(view, "分叉").click();
    expect(confirm).not.toHaveBeenCalled();
    expect(button(view, "复制用户消息").disabled).toBe(false);
    expect(button(view, "Note").disabled).toBe(false);
    view.messageActionContext = base;
    view.onMessageAction = vi.fn(() => Promise.reject(new Error("History changed")));
    await settle(view);
    button(view, "回退").click();
    await settle(view);
    expect(view.renderRoot.querySelector('[role="alert"]')?.textContent).toBe("History changed");
  });

  it("does not repeat historical availability checks or fetch on unrelated stream/render updates", async () => {
    const visible = vi.fn<NonNullable<EntryMessageActionContribution["visible"]>>(() => true);
    const enabled = vi.fn<NonNullable<EntryMessageActionContribution["enabled"]>>(() => true);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { view, registry } = await mount([{ id: "note", title: "Note", visible, enabled, run: () => undefined }]);
    const history = view.messages[0];
    if (history === undefined) throw new Error("Expected historical message");
    expect(visible).toHaveBeenCalledTimes(1);
    for (const text of ["One", "Two", "Three"]) {
      view.messages = [history, { role: "assistant", parts: [{ type: "text", text }] }];
      // The app makes new small snapshots/lists on each render; identities of
      // the registered actions and unchanged transcript lines remain stable.
      view.messageActionContext = { machine: { ...base.machine }, session: { ...base.session } };
      view.messageActions = registry.getMessageActions("local");
      await settle(view);
    }
    expect(visible).toHaveBeenCalledTimes(1);
    expect(enabled).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    const updated: ChatLine = { ...history, parts: [{ type: "text", text: "Changed" }] };
    view.messages = [updated];
    await settle(view);
    expect(visible).toHaveBeenCalledTimes(2);
    expect(visible).toHaveBeenLastCalledWith(expect.objectContaining({ message: { entryId: "entry-1", role: "user", text: "Changed" } }));
    view.messageActionContext = { ...base, session: { ...base.session, archived: true } };
    await settle(view);
    expect(enabled).toHaveBeenCalledTimes(3);
    expect(button(view, "分叉").disabled).toBe(true);
  });
});

it.each([false, true])("offers existing history actions on question requests (answered: %s), targeting the tool result", async (answered) => {
    const { view } = await mount();
    const question = { id: "q", question: "Choose?", options: [] };
    const ask = { askId: "ask", askedAt: "2026-07-20T10:00:00.000Z", questions: [question] };
    view.messages = normalizeMessages([
      { role: "assistant", content: [{ type: "toolCall", id: "ask-call", name: "ask_user", arguments: { questions: ask.questions } }] },
      { role: "toolResult", toolName: "ask_user", toolCallId: "ask-call", entryId: "question-result",
        content: "Questions posted", details: { ask }, isError: false },
    ]);
    if (answered) view.messages = [...view.messages, { role: "user", entryId: "answer-record", parts: [{ type: "askUserRecord", outcome: {
      askId: ask.askId, askedAt: ask.askedAt, closedAt: "2026-07-20T10:01:00.000Z", reason: "submitted",
      questions: [{ question, answered: true, values: [], otherText: "Custom answer" }],
      answeredCount: 1, unansweredIds: [], summary: "Answered",
    } }] }];
    view.historyReady = true;
    view.onSubmitAsk = vi.fn();
    const onAction = vi.fn().mockResolvedValue(undefined);
    view.onMessageAction = onAction;
    await settle(view);

    const card = view.renderRoot.querySelector("ask-user-card");
    expect(card?.classList.contains(answered ? "closed-question-card" : "open-question-card")).toBe(true);
    expect(card?.closest(".event-group")).toBeNull();
    expect(buttons(view).map((button) => button.getAttribute("aria-label"))).toEqual([
      "分叉", "回退",
    ]);
    expect(card?.parentElement?.querySelectorAll(".msg-action")).toHaveLength(2);
    button(view, "回退").click();
    await settle(view);
    button(view, "分叉").click();
    await settle(view);
    const expected = { ...base, message: { entryId: "question-result", role: "tool", text: "", isQuestion: true } };
    expect(onAction.mock.calls).toEqual([[expected, "core:message.back"], [expected, "core:message.fork"]]);

    view.messages = view.messages.map((message) => {
      const entryless = { ...message };
      delete entryless.entryId;
      return entryless;
    });
    await settle(view);
    expect(buttons(view)).toEqual([]);
  });

it("targets the real entry and anchor when an event group spans invisible conversation entries", async () => {
    const { view } = await mount([{ id: "inspect", title: "Inspect entry", run: () => undefined }]);
    const onEntry = vi.fn(() => Promise.resolve());
    view.onMessageAction = onEntry;
    view.messageStart = 20;
    view.messages = [
      { role: "assistant", entryId: "first", parts: [{ type: "thinking", text: "First thought" }] },
      { role: "tool", entryId: "boundary", parts: [{ type: "toolResultBoundary", toolCallId: "earlier" }] },
      { role: "assistant", entryId: "empty", parts: [{ type: "empty" }] },
      { role: "assistant", entryId: "last", parts: [{ type: "thinking", text: "Last thought" }] },
    ];
    await settle(view);
    const groups = view.renderRoot.querySelectorAll("details.event-group");
    expect(groups).toHaveLength(1);
    const group = groups[0];
    if (!(group instanceof HTMLDetailsElement)) throw new Error("Missing event group");
    group.open = true;
    group.dispatchEvent(new Event("toggle"));
    await settle(view);
    const sections = Array.from(groups[0]?.querySelectorAll<HTMLElement>("section.group-msg") ?? []);
    expect(sections.map((section) => section.dataset["index"])).toEqual(["20", "23"]);
    expect(sections.map((section) => section.dataset["scrollAnchorId"])).toEqual(['e:["first","assistant","message"]', 'e:["last","assistant","message"]']);
    const action = sections[1]?.querySelector<HTMLButtonElement>('button[title="Inspect entry"]');
    if (action === null || action === undefined) throw new Error("Missing last entry action");
    action.click();
    await settle(view);
    expect(onEntry).toHaveBeenCalledExactlyOnceWith({
      ...base, message: { entryId: "last", role: "assistant", text: "" },
    }, "custom:inspect");
  });

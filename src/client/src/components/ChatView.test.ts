import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { QueuedSessionMessage, SessionStatus } from "../api";
import type { ChatLine } from "../chatTypes";
import { ChatView, activityStateLabel, chatMessageMetadataLabel, chatQueuedMessageSections, messageTranscriptIndex } from "./ChatView";
import { isTemplateResult, templateStrings, templateValues, templateValuesAfterMarker } from "../templateInspection.testSupport";

describe("chatQueuedMessageSections", () => {
  it("labels client-side pending-start sends separately from server queued messages", () => {
    const sections = chatQueuedMessageSections(
      [{ kind: "followUp", text: "queued before start" }],
      [{ kind: "steer", text: "server queued" }],
    );

    expect(sections).toEqual([
      {
        source: "client",
        heading: "等待会话启动",
        detail: "后端会话准备好后将自动发送",
        messages: [{ kind: "followUp", text: "queued before start" }],
      },
      {
        source: "server",
        heading: "排队消息",
        detail: "1 条待处理 · 停止会清空队列",
        messages: [{ kind: "steer", text: "server queued" }],
      },
    ]);
  });
});

describe("activityStateLabel", () => {
  it("localizes known, parameterized, and unknown dynamic activity labels", () => {
    expect(activityStateLabel("resources reloaded")).toBe("资源已重新加载");
    expect(activityStateLabel("model: gpt-test")).toBe("模型：gpt-test");
    expect(activityStateLabel("thinking: medium")).toBe("思考级别：中");
    expect(activityStateLabel("unmapped_runtime_event", "active")).toBe("运行中");
    expect(activityStateLabel("unmapped_runtime_event", "error")).toBe("发生错误");
    expect(activityStateLabel("unmapped_runtime_event", "idle")).toBe("空闲");
  });
});

describe("messageTranscriptIndex", () => {
  it("falls back to the displayed transcript offset when live replay dropped message metadata", () => {
    expect(messageTranscriptIndex({ role: "user", parts: [{ type: "text", text: "question" }] }, 9)).toBe(9);
    expect(messageTranscriptIndex({ role: "assistant", parts: [{ type: "text", text: "answer" }], transcriptIndex: 17 }, 9)).toBe(17);
  });
});

describe("ChatView queued-message clear action", () => {
  // Direct handler extraction keeps this node-environment test focused on the
  // Clear queue template wiring without introducing a component-wide DOM shim.
  it("renders an accessible server-queue action and invokes its callback", () => {
    const view = new ChatView();
    const onClearServerQueue = vi.fn();
    view.status = queuedStatus([{ kind: "steer", text: "server queued" }]);
    view.canClearServerQueue = true;
    view.onClearServerQueue = onClearServerQueue;

    const rendered = renderQueuedMessages(view);
    const markup = templateStaticMarkup(rendered);

    expect(markup).toContain('type="button"');
    expect(markup).toContain('title="清空排队消息，不停止正在进行的工作"');
    expect(markup).toContain(">清空队列</button>");
    templateEventHandler(rendered, "清空队列")(new Event("click"));
    expect(onClearServerQueue).toHaveBeenCalledOnce();
  });

  it("hides the action when the selected runtime does not support clearing", () => {
    const view = new ChatView();
    view.status = queuedStatus([{ kind: "followUp", text: "server queued" }]);
    view.canClearServerQueue = false;
    view.onClearServerQueue = vi.fn();

    expect(templateStaticMarkup(renderQueuedMessages(view))).not.toContain("清空队列");
  });

  it("does not expose the server action for the separate client pending-start queue", () => {
    const view = new ChatView();
    view.status = queuedStatus([]);
    view.clientQueuedMessages = [{ kind: "followUp", text: "waiting for session start" }];
    view.canClearServerQueue = true;
    view.onClearServerQueue = vi.fn();

    expect(templateStaticMarkup(renderQueuedMessages(view))).not.toContain("清空队列");
  });
});

describe("chatMessageMetadataLabel", () => {
  it("uses one full date and model label without a model prefix", () => {
    const timestamp = "2026-07-10T19:15:30.000Z";
    const formattedTimestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(timestamp));

    expect(chatMessageMetadataLabel({
      role: "assistant",
      parts: [],
      meta: { timestamp, model: { provider: "provider", id: "model" } },
    })).toBe(`${formattedTimestamp} · provider/model`);
  });
});

describe("ChatView technical-event groups", () => {
  const messages: ChatLine[] = [
    { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "inspect a file" }] },
    { role: "tool", parts: [{ type: "toolExecution", toolName: "read", summary: "inspect a file", status: "success", resultText: "large result" }] },
  ];

  it("defers a closed body while retaining native disclosure and group scroll anchors", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);

    const closed = renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([]);
    expect(templateStaticMarkup(closed)).toContain("<details");
    expect(templateStaticMarkup(closed)).toContain("<summary>");
    expect(templateStaticMarkup(closed)).toContain('aria-hidden="true"');
    expect(templateValuesAfterMarker(closed, "?open=")).toEqual([false]);
    expect(templateValuesAfterMarker(closed, "data-scroll-anchor-id=")).toEqual(["g:40"]);
    expect(templateValuesAfterMarker(closed, "data-marker-id=")).toEqual(["g:41"]);
  });

  // Direct handler extraction keeps this node-environment test focused on the
  // native details toggle wiring without introducing a component-wide DOM shim.
  it("renders an opened body with event anchors and removes it when closed again", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);
    const initiallyClosed = renderMessageGroup(view, messages, 40, 41, false);

    dispatchDetailsToggle(templateEventHandler(initiallyClosed, "@toggle="), true);
    const opened = renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([{ messages, startIndex: 40 }]);
    expect(templateValuesAfterMarker(opened, "?open=")).toEqual([true]);
    expect(templateValuesAfterMarker(opened, "data-scroll-anchor-id=")).toEqual(["g:40", "e:40", "e:41"]);

    bodyCalls.length = 0;
    dispatchDetailsToggle(templateEventHandler(opened, "@toggle="), false);
    const closedAgain = renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([]);
    expect(templateValuesAfterMarker(closedAgain, "?open=")).toEqual([false]);
    expect(templateValuesAfterMarker(closedAgain, "data-scroll-anchor-id=")).toEqual(["g:40"]);
  });

  it("renders a live tail body by default", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);

    const live = renderMessageGroup(view, messages, 40, 41, true);

    expect(bodyCalls).toEqual([{ messages, startIndex: 40 }]);
    expect(templateValuesAfterMarker(live, "?open=")).toEqual([true]);
    expect(templateValues(live)).toContain("msg event-group live");
    expect(templateValues(live)).toContain("实时事件");
  });
});

interface GroupBodyRenderCall {
  messages: ChatLine[];
  startIndex: number;
}

type RenderQueuedMessages = (this: ChatView) => TemplateResult;
type RenderMessageGroup = (this: ChatView, messages: ChatLine[], startIndex: number, endIndex: number, defaultOpen: boolean) => TemplateResult;
type RenderMessageGroupBody = (this: ChatView, messages: ChatLine[], startIndex: number) => TemplateResult;
type TemplateEventHandler = (event: Event) => void;

function renderQueuedMessages(view: ChatView): TemplateResult {
  const method: unknown = Reflect.get(view, "renderQueuedMessages");
  if (!isRenderQueuedMessages(method)) throw new Error("ChatView.renderQueuedMessages is not callable");
  return method.call(view);
}

function renderMessageGroup(view: ChatView, messages: ChatLine[], startIndex: number, endIndex: number, defaultOpen: boolean): TemplateResult {
  const method: unknown = Reflect.get(view, "renderMessageGroup");
  if (!isRenderMessageGroup(method)) throw new Error("ChatView.renderMessageGroup is not callable");
  return method.call(view, messages, startIndex, endIndex, defaultOpen);
}

function observeGroupBodyRenders(view: ChatView): GroupBodyRenderCall[] {
  const method: unknown = Reflect.get(view, "renderMessageGroupBody");
  if (!isRenderMessageGroupBody(method)) throw new Error("ChatView.renderMessageGroupBody is not callable");
  const calls: GroupBodyRenderCall[] = [];
  const observed: RenderMessageGroupBody = function (messages, startIndex) {
    calls.push({ messages, startIndex });
    return method.call(this, messages, startIndex);
  };
  if (!Reflect.set(view, "renderMessageGroupBody", observed)) throw new Error("Could not observe ChatView.renderMessageGroupBody");
  return calls;
}

function isRenderQueuedMessages(value: unknown): value is RenderQueuedMessages {
  return typeof value === "function";
}

function isRenderMessageGroup(value: unknown): value is RenderMessageGroup {
  return typeof value === "function";
}

function isRenderMessageGroupBody(value: unknown): value is RenderMessageGroupBody {
  return typeof value === "function";
}

function templateEventHandler(template: TemplateResult, marker: string): TemplateEventHandler {
  let handler: TemplateEventHandler | undefined;
  visit(template);
  if (handler === undefined) throw new Error(`Expected template event handler near ${marker}`);
  return handler;

  function visit(value: unknown): void {
    if (handler !== undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isTemplateResult(value)) return;
    const strings = templateStrings(value);
    const values = templateValues(value);
    for (let index = 0; index < values.length; index += 1) {
      const candidate = values[index];
      const isNearMarker = strings[index]?.includes(marker) === true || strings[index + 1]?.includes(marker) === true;
      if (isNearMarker && isTemplateEventHandler(candidate)) {
        handler = candidate;
        return;
      }
      visit(candidate);
    }
  }
}

function isTemplateEventHandler(value: unknown): value is TemplateEventHandler {
  return typeof value === "function";
}

function dispatchDetailsToggle(handler: TemplateEventHandler, open: boolean): void {
  const hadDetailsElement = Reflect.has(globalThis, "HTMLDetailsElement");
  const previousDetailsElement = Reflect.get(globalThis, "HTMLDetailsElement");
  class StubDetailsElement extends EventTarget {
    constructor(readonly open: boolean) {
      super();
    }
  }
  Reflect.set(globalThis, "HTMLDetailsElement", StubDetailsElement);
  try {
    const details = new StubDetailsElement(open);
    details.addEventListener("toggle", (event) => { handler(event); });
    details.dispatchEvent(new Event("toggle"));
  } finally {
    if (hadDetailsElement) Reflect.set(globalThis, "HTMLDetailsElement", previousDetailsElement);
    else Reflect.deleteProperty(globalThis, "HTMLDetailsElement");
  }
}

function templateStaticMarkup(template: TemplateResult): string {
  const chunks: string[] = [];
  visit(template);
  return chunks.join("");

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isTemplateResult(value)) return;
    chunks.push(...templateStrings(value));
    for (const child of templateValues(value)) visit(child);
  }
}


function queuedStatus(queuedMessages: QueuedSessionMessage[]): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: queuedMessages.length,
    queuedMessages,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

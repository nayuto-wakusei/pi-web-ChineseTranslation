// @vitest-environment happy-dom
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { setClientTranslations } from "../i18n";
beforeEach(() => { setClientTranslations("en", {}); });
import { MANUAL_CHAT_BEHAVIORS } from "../chatBehaviors.testSupport";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";
import type { FormattedText } from "./FormattedText";
import { settleDeferredContent, useDeferredContent } from "../formatting/deferredContent.testSupport";

useDeferredContent();

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function mount(messages: ChatLine[], live = false): Promise<ChatView> {
  const view = new ChatView();
  view.behaviors = MANUAL_CHAT_BEHAVIORS;
  view.messages = messages;
  view.isSendingPrompt = live;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function thought(entryId?: string): ChatLine {
  return { ...(entryId === undefined ? {} : { entryId }), role: "assistant", parts: [{ type: "thinking", text: "Thinking" }] };
}

describe("ChatView durable DOM scroll anchors", () => {
  it("locates search hits by raw transcript index, highlights only visible text, and retires stale navigation", async () => {
    const view = await mount([
      { role: "user", transcriptIndex: 40, parts: [{ type: "text", text: "Earlier needle" }] },
      { role: "user", transcriptIndex: 43, parts: [{ type: "skillInvocation", name: "test", location: "/test", content: "Hidden needle" }] },
      { role: "assistant", transcriptIndex: 43, parts: [{ type: "thinking", text: "Hidden needle" }, { type: "text", text: "Visible needle" }] },
    ]);
    view.sessionId = "searched";
    view.messageStart = 40;
    view.historyReady = false;
    await view.updateComplete;
    const chat = view.renderRoot.querySelector<HTMLElement>(".chat");
    const hit = view.renderRoot.querySelector<HTMLElement>('article.msg[data-index="42"]');
    const text = hit?.querySelector<FormattedText>("formatted-text");
    if (chat == null || hit == null || text == null) throw new Error("Missing searchable transcript");
    vi.spyOn(chat, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 50, 500, 600));
    vi.spyOn(hit, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 350, 500, 100));
    view.searchTarget = { sessionId: "searched", messageIndex: 43, query: "needle", requestId: 1 };
    await view.updateComplete;
    expect(chat.scrollTop).toBe(0);
    view.historyReady = true;
    await vi.waitFor(() => { expect(chat.scrollTop).toBe(300); });
    await settleDeferredContent(text);
    expect(text.renderRoot.querySelector("mark[data-search-highlight]")?.textContent).toBe("needle");
    expect(view.renderRoot.querySelector<HTMLDetailsElement>("details.event-group")?.open).toBe(false);
    expect(view.renderRoot.querySelector<FormattedText>('article.user formatted-text')?.highlight).toBe("");

    chat.scrollTop = 80;
    view.messages = [...view.messages];
    await view.updateComplete;
    expect(chat.scrollTop).toBe(80);
    view.searchTarget = { ...view.searchTarget, requestId: 2 };
    await vi.waitFor(() => { expect(chat.scrollTop).toBe(380); });
    view.searchTarget = undefined;
    await view.updateComplete;
    expect(text.highlight).toBe("");
    view.searchTarget = { sessionId: "other", messageIndex: 43, query: "needle", requestId: 3 };
    await view.updateComplete;
    expect(text.highlight).toBe("");
    expect(chat.scrollTop).toBe(380);

    let finish!: (value: boolean) => void;
    const rendering = new Promise<boolean>((resolve) => { finish = resolve; });
    vi.spyOn(text, "updateComplete", "get").mockReturnValueOnce(rendering);
    view.searchTarget = { sessionId: "searched", messageIndex: 43, query: "needle", requestId: 4 };
    await view.updateComplete;
    view.machineId = "remote";
    await view.updateComplete;
    finish(true);
    await rendering;
    expect(chat.scrollTop).toBe(380);
    expect(text.isConnected).toBe(false);
    expect(Array.from(view.renderRoot.querySelectorAll<FormattedText>("formatted-text"), (node) => node.highlight)).not.toContain("needle");
  });

  it.each([false, true])("selects the durable group boundary, skipping unidentified members (live: %s)", async (live) => {
    const view = await mount([thought(), thought("first"), thought("last"), thought("")], live);
    const groupAnchor = view.renderRoot.querySelector("details.event-group")?.getAttribute("data-scroll-anchor-id");
    expect(groupAnchor).toBe(live
      ? 'g:["first","assistant","message"]'
      : 'g-end:["last","assistant","message"]');
    if (!live) {
      expect(view.renderRoot.querySelector("section.group-msg")).toBeNull();
      const group = view.renderRoot.querySelector<HTMLDetailsElement>("details.event-group");
      if (group === null) throw new Error("Missing group");
      group.open = true; group.dispatchEvent(new Event("toggle"));
      await view.updateComplete;
    }
    const members = Array.from(view.renderRoot.querySelectorAll("section.group-msg"));
    expect(members.map((member) => member.getAttribute("data-scroll-anchor-id"))).toEqual([
      null, 'e:["first","assistant","message"]', 'e:["last","assistant","message"]', null,
    ]);

    // New transient boundary members cannot change a group's scroll identity.
    view.messages = [thought(""), ...view.messages, thought()];
    view.messageStart = 100;
    await view.updateComplete;
    expect(view.renderRoot.querySelector("details.event-group")?.getAttribute("data-scroll-anchor-id"))
      .toBe(groupAnchor);
  });

  it.each([false, true])("omits anchors but still renders groups with no durable members (live: %s)", async (live) => {
    const view = await mount([thought(), thought("")], live);
    expect(view.renderRoot.querySelectorAll("section.group-msg")).toHaveLength(live ? 2 : 0);
    expect(view.renderRoot.querySelector("details.event-group")).not.toBeNull();
    expect(view.renderRoot.querySelector("[data-scroll-anchor-id]")).toBeNull();
  });

  it("renders unidentified readable messages and tool images without index anchors", async () => {
    const question: ChatLine = { role: "user", parts: [{ type: "text", text: "Question" }] };
    const image: ChatLine = { entryId: "", role: "tool", parts: [{ type: "image", mimeType: "image/png", data: "QUJD" }] };
    const view = await mount([question, image]);
    expect(view.renderRoot.querySelectorAll("article.msg")).toHaveLength(2);
    expect(view.renderRoot.querySelector("article.tool-image-output")).not.toBeNull();
    expect(view.renderRoot.querySelector("[data-scroll-anchor-id]")).toBeNull();

    view.messages = [{ ...question, entryId: "question" }, image];
    await view.updateComplete;
    expect(view.renderRoot.querySelector("article.user")?.getAttribute("data-scroll-anchor-id"))
      .toBe('m:["question","user","message"]');
    view.messages = [{ ...question, entryId: "" }, image];
    await view.updateComplete;
    expect(view.renderRoot.querySelector("[data-scroll-anchor-id]")).toBeNull();
  });

  it("keeps readable and technical slices of one durable entry distinct and compatible", async () => {
    const view = await mount([{ entryId: "reply", role: "assistant", parts: [
      { type: "thinking", text: "Thought" }, { type: "text", text: "Reply" },
    ] }]);
    const group = view.renderRoot.querySelector<HTMLDetailsElement>("details.event-group");
    if (group === null) throw new Error("Missing group");
    expect(group.getAttribute("data-scroll-anchor-id")).toBe('g-end:["reply","assistant","message"]');
    group.open = true; group.dispatchEvent(new Event("toggle"));
    await view.updateComplete;
    expect(Array.from(view.renderRoot.querySelectorAll("[data-scroll-anchor-id]"),
      (node) => node.getAttribute("data-scroll-anchor-id"))).toEqual([
      'g-end:["reply","assistant","message"]',
      'e:["reply","assistant","message"]',
      'm:["reply","assistant","message"]',
    ]);
  });
});

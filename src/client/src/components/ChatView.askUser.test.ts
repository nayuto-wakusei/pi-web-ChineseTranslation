// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskUserOutcome } from "../../../shared/apiTypes";
import { AskUserCard } from "./AskUserCard";
import { ChatView } from "./ChatView";
import { controlledChatViewport, manualChatFrames } from "./chatScroll.testSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChatView open ask_user form", () => {
  it("scrolls a newly opened form to its start and gives it a stable chat-scroll anchor", async () => {
    const flushFrames = manualChatFrames();
    const view = new ChatView();
    view.sessionId = "session-1";
    document.body.append(view);
    await view.updateComplete;
    const { metrics, write } = controlledChatViewport(view);
    flushFrames();
    write.mockClear();
    metrics.height = 4000;
    view.historyReady = true;

    view.onSubmitAsk = () => undefined;
    view.messages = [{ role: "tool", entryId: "question-entry", parts: [{ type: "askUserQuestion", ask: {
      askId: "ask-open",
      askedAt: "2026-07-20T10:00:00.000Z",
      questions: [{ id: "editor", question: "Which editor?", options: [{ value: "vim", label: "Vim" }] }],
    } }] }];
    await view.updateComplete;

    const card = requiredElement(view.renderRoot.querySelector("ask-user-card"), "open ask form");
    card.getBoundingClientRect = () => new DOMRect(0, 600, 600, 500);
    flushFrames();
    expect(write).toHaveBeenCalledExactlyOnceWith(2200);
    expect(metrics.top).toBe(2200);
    expect(view.shadowRoot?.querySelector("ask-user-card")?.parentElement?.getAttribute("data-scroll-anchor-id")).toBe('m:["question-entry","tool","message"]');
  });
});

describe("ChatView ask_user transcript records", () => {
  it("renders a projected outcome as the read-only question card with the machine-scoped draft key", async () => {
    const outcome: AskUserOutcome = {
      askId: "ask-1",
      reason: "submitted",
      askedAt: "2026-07-20T10:00:00.000Z",
      closedAt: "2026-07-20T10:05:00.000Z",
      questions: [
        {
          question: { id: "editor", question: "Which editor?", options: [{ value: "vim", label: "Vim" }] },
          answered: true,
          values: ["vim"],
        },
        {
          question: { id: "region", question: "Which region?", options: [{ value: "eu", label: "Europe" }] },
          answered: false,
          values: [],
        },
      ],
      answeredCount: 1,
      unansweredIds: ["region"],
      summary: "Answered 1 of 2; unanswered: region",
    };
    const view = new ChatView();
    view.sessionId = "session-1";
    view.askDraftSessionId = "remote-a:session-1";
    view.messages = [{ role: "system", parts: [{ type: "askUserRecord", outcome }] }];
    document.body.append(view);
    await view.updateComplete;

    const card = requiredElement(view.shadowRoot?.querySelector("ask-user-card"), "ask_user record card");
    expect(card).toBeInstanceOf(AskUserCard);
    expect(card.outcome).toEqual(outcome);
    expect(card.ask).toBeUndefined();
    expect(card.draftSessionId).toBe("remote-a:session-1");
    await card.updateComplete;

    const cardRoot = requiredElement(card.shadowRoot, "ask_user record shadow root");
    expect(cardRoot.textContent).toContain("回答已发送");
    expect(cardRoot.textContent).toContain("已回答 1/2 个问题；未回答：region");
    expect(cardRoot.textContent).not.toContain("Answered 1 of 2");
    expect(cardRoot.textContent).toContain("Vim");
    expect(cardRoot.textContent).toContain("Which region?");
    expect(cardRoot.textContent).toContain("未回答");
    expect(cardRoot.querySelector("input, textarea, button, select")).toBeNull();
    expect(view.shadowRoot?.querySelector("article.ask-user-record-shell .msg-header")).toBeNull();
  });
});

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

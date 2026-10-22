// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatLine } from "./shared";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ChatView transcript rendering", () => {
  it("reports transcript coverage only after the corresponding messages have rendered", async () => {
    const view = await renderView([message("user", "old question")]);
    const onTranscriptRendered = vi.fn(() => {
      expect(view.shadowRoot?.querySelector("formatted-text")?.shadowRoot?.textContent).toContain("new answer");
    });
    const messages = [message("assistant", "new answer")];
    view.onTranscriptRendered = onTranscriptRendered;
    view.messages = messages;
    view.messageStart = 200;
    view.messageEnd = 350;
    expect(onTranscriptRendered).not.toHaveBeenCalled();
    await view.updateComplete;
    await vi.waitFor(() => { expect(onTranscriptRendered).toHaveBeenCalled(); });
    expect(onTranscriptRendered).toHaveBeenCalledWith({ sessionId: "session-1", messages, start: 200, end: 350 });
  });

  it("avoids transcript scans for text-only updates and retains existing articles on append", async () => {
    const user = message("user", "question");
    const view = await renderView([user, message("assistant", "partial")]);
    const root = view.shadowRoot;
    if (root === null) throw new Error("Missing ChatView shadow root");
    const original = root.querySelector("article.user");
    const querySelectorAll = vi.spyOn(root, "querySelectorAll");

    view.messages = [user, message("assistant", "partial answer")];
    await view.updateComplete;
    expect(querySelectorAll).not.toHaveBeenCalled();

    view.messages = [user, message("assistant", "partial answer"), message("user", "next")];
    await view.updateComplete;
    expect(root.querySelector("article.user")).toBe(original);
    expect(root.querySelectorAll("article.user")).toHaveLength(2);
  });

  it("retains durable article anchors through prepend without synthetic scroll markers", async () => {
    const messages = [message("user", "question"), message("assistant", "answer")];
    const view = await renderView(messages);
    view.messageStart = 10;
    await view.updateComplete;
    const article = view.renderRoot.querySelector<HTMLElement>("article.user");
    if (article === null) throw new Error("Missing user article");
    const anchor = article.dataset["scrollAnchorId"];
    expect(anchor).toBe('m:["user:question","user","message"]');
    view.messages = [message("user", "earlier"), ...messages];
    view.messageStart = 9;
    await view.updateComplete;
    expect(view.renderRoot.querySelector('article[data-index="10"]')).toBe(article);
    expect(article.dataset["scrollAnchorId"]).toBe(anchor);
    expect(view.renderRoot.querySelector(".scroll-marker")).toBeNull();
  });

});

async function renderView(messages: ChatLine[]): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.messages = messages;
  view.messageTotal = messages.length;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function message(role: ChatLine["role"], text: string): ChatLine {
  return { role, entryId: `${role}:${text}`, parts: [{ type: "text", text }] };
}

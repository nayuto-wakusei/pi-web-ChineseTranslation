import { describe, expect, it } from "vitest";
import { ChatTranscriptStore, transcriptViewFromHistory, type ChatHistoryCacheAdapter } from "./chatTranscriptStore";
import type { RawMessagePage } from "./chatHistoryCache";

class MemoryChatHistoryCache implements ChatHistoryCacheAdapter {
  readonly pages = new Map<string, RawMessagePage>();

  read(sessionId: string): RawMessagePage | undefined {
    return this.pages.get(sessionId);
  }

  write(sessionId: string, page: RawMessagePage): void {
    this.pages.set(sessionId, page);
  }
}

function page(start: number, total: number, messages: unknown[]): RawMessagePage {
  return { start, total, messages };
}

describe("ChatTranscriptStore", () => {
  it("hydrates a visible transcript from cached raw history", () => {
    const cache = new MemoryChatHistoryCache();
    cache.write("s1", page(0, 2, [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]));

    expect(new ChatTranscriptStore(cache).cachedView("s1")).toEqual({
      messages: [
        { role: "user", parts: [{ type: "text", text: "hi" }], transcriptIndex: 0 },
        { role: "assistant", parts: [{ type: "text", text: "hello" }], transcriptIndex: 1 },
      ],
      messagePageStart: 0,
      messagePageEnd: 2,
      messagePageTotal: 2,
    });
  });

  it("preserves raw transcript positions on normalized history messages", () => {
    const view = transcriptViewFromHistory({
      messages: [
        { role: "user", content: "question" },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
      ],
      start: 12,
      total: 20,
    });

    expect(view.messages.map((message) => message.transcriptIndex)).toEqual([12, 13]);
  });

  it("tracks the raw page end separately from normalized display messages", () => {
    const store = new ChatTranscriptStore(new MemoryChatHistoryCache());

    const view = store.mergeHistory("s1", page(0, 3, [
      { role: "user", content: "run the tool" },
      { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "src/app.ts" } }] },
      { role: "toolResult", toolCallId: "tool-1", toolName: "read", content: [{ type: "text", text: "ok" }] },
    ]));

    expect(view.messages).toHaveLength(2);
    expect(view.messagePageStart).toBe(0);
    expect(view.messagePageEnd).toBe(3);
    expect(view.messagePageTotal).toBe(3);
  });

  it("keeps live streamed transcript state out of the raw history cache", () => {
    const cache = new MemoryChatHistoryCache();
    const store = new ChatTranscriptStore(cache);
    const initial = page(0, 2, [{ role: "user", content: "hi" }, { role: "assistant", content: "hel" }]);
    const updated = page(1, 3, [{ role: "assistant", content: "hello" }, { role: "user", content: "next" }]);

    let visible = store.mergeHistory("s1", initial).messages;
    visible = store.applyLiveEvent(visible, { type: "assistant.delta", text: "lo" }) ?? visible;

    expect(visible.at(-1)).toEqual({ role: "assistant", parts: [{ type: "text", text: "hello" }], transcriptIndex: 1 });
    expect(cache.read("s1")?.messages).toEqual(initial.messages);
    expect(store.mergeHistory("s1", updated)).toEqual({
      messages: [
        { role: "user", parts: [{ type: "text", text: "hi" }], transcriptIndex: 0 },
        { role: "assistant", parts: [{ type: "text", text: "hello" }], transcriptIndex: 1 },
        { role: "user", parts: [{ type: "text", text: "next" }], transcriptIndex: 2 },
      ],
      messagePageStart: 0,
      messagePageEnd: 3,
      messagePageTotal: 3,
    });
  });
});

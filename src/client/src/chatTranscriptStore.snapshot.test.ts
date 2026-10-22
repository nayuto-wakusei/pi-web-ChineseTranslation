import { describe, expect, it } from "vitest";
import { ChatTranscriptStore, type ChatHistoryCacheAdapter } from "./chatTranscriptStore";
import { canMergeHistorySnapshot, type RawMessagePage } from "./chatHistoryCache";

class MemoryChatHistoryCache implements ChatHistoryCacheAdapter {
  readonly pages = new Map<string, RawMessagePage>();
  read(sessionId: string): RawMessagePage | undefined { return this.pages.get(sessionId); }
  write(sessionId: string, page: RawMessagePage): void { this.pages.set(sessionId, page); }
}

function page(start: number, total: number, messages: unknown[]): RawMessagePage { return { start, total, messages }; }

describe("authoritative transcript snapshots", () => {
  it("replaces incompatible cached snapshots even when the cache adapter cannot remove entries", () => {
    const cache = new MemoryChatHistoryCache();
    cache.write("s1", page(1, 4, [
      { role: "user", content: "old-a" }, { role: "assistant", content: "old-b" }, { role: "user", content: "old-c" },
    ]));
    const store = new ChatTranscriptStore(cache);
    const current = page(1, 3, [{ role: "user", content: "new-a" }, { role: "assistant", content: "new-b" }]);
    const view = store.mergeSnapshot("s1", current);
    expect(view.messagePageTotal).toBe(3);
    expect(store.rawHistoryPage("s1")).toEqual(current);
    expect(cache.read("s1")).toEqual(current);
    expect(store.historyRevision("s1")).toBe(1);
  });

  it("retires pagination on leaf changes even when raw history overlaps", () => {
    const store = new ChatTranscriptStore(new MemoryChatHistoryCache());
    const messages = [{ role: "user", content: "shared" }];
    const first = { ...page(0, 1, messages), leafId: "branch-a" };
    const current = { ...first, leafId: "branch-b" };
    expect(canMergeHistorySnapshot(first, current)).toBe(false);
    store.mergeSnapshot("machine:s1", first);
    expect(store.historyRevision("machine:s1")).toBe(0);
    const view = store.mergeSnapshot("machine:s1", current);
    expect(view.messagePageLeafId).toBe("branch-b");
    expect(store.historyRevision("machine:s1")).toBe(1);
    expect(store.rawHistoryPage("machine:s1")).toEqual(current);
  });
});

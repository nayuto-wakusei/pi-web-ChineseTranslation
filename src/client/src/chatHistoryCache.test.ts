import { describe, expect, it } from "vitest";
import { mergeChatHistory, type RawMessagePage } from "./chatHistoryCache";

function page(start: number, total: number, messages: unknown[]): RawMessagePage {
  return { start, total, messages };
}

describe("mergeChatHistory", () => {
  it("merges pages from the same completed branch but never proves coverage using a different branch", () => {
    const existing = { ...page(2, 4, ["c", "d"]), leafId: "leaf-1" };
    const incoming = { ...page(0, 4, ["a", "b"]), leafId: "leaf-1" };
    expect(mergeChatHistory(existing, incoming)).toEqual({ ...page(0, 4, ["a", "b", "c", "d"]), leafId: "leaf-1" });
    const otherBranch = { ...incoming, leafId: "leaf-2" };
    expect(mergeChatHistory(existing, otherBranch)).toEqual(otherBranch);
    expect(mergeChatHistory(page(2, 4, ["stale-c", "stale-d"]), incoming)).toEqual(incoming);
  });

  it("merges adjacent cached and incoming pages", () => {
    const merged = mergeChatHistory(page(2, 5, ["c", "d", "e"]), page(0, 5, ["a", "b"]));

    expect(merged).toEqual(page(0, 5, ["a", "b", "c", "d", "e"]));
  });

  it("keeps cached history when new messages were appended", () => {
    const existing = page(0, 3, ["a", "b", "c"]);
    const incoming = page(1, 4, ["b", "c", "d"]);

    expect(mergeChatHistory(existing, incoming)).toEqual(page(0, 4, ["a", "b", "c", "d"]));
  });

  it("uses incoming history when a complete cached history shrinks", () => {
    const incoming = page(0, 2, ["fresh-a", "fresh-b"]);

    expect(mergeChatHistory(page(0, 3, ["stale-a", "stale-b", "stale-c"]), incoming)).toEqual(incoming);
  });

  it("keeps adjacent cached history when an older page reports a lower total", () => {
    const existing = page(100, 200, ["newer-a", "newer-b"]);
    const incoming = page(98, 150, ["older-a", "older-b"]);

    expect(mergeChatHistory(existing, incoming)).toEqual(page(98, 200, ["older-a", "older-b", "newer-a", "newer-b"]));
  });

  it("uses incoming history instead of creating a gapped page", () => {
    const incoming = page(8, 10, ["i", "j"]);

    expect(mergeChatHistory(page(0, 10, ["a", "b"]), incoming)).toEqual(incoming);
  });

  it("uses incoming history when cached history contains normalized chat lines", () => {
    const incoming = page(0, 2, [{ role: "user", content: "fresh" }, { role: "assistant", content: "answer" }]);
    const normalizedLine = { role: "assistant", parts: [{ type: "text", text: "duplicated display line" }] };

    expect(mergeChatHistory(page(0, 2, [incoming.messages[0], normalizedLine]), incoming)).toEqual(incoming);
  });

  it("uses incoming history when cached history is longer than its raw range", () => {
    const incoming = page(0, 2, ["fresh-a", "fresh-b"]);

    expect(mergeChatHistory(page(0, 2, ["stale-a", "stale-b", "stale-c"]), incoming)).toEqual(incoming);
  });
});

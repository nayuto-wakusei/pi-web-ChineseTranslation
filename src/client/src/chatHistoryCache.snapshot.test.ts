import { describe, expect, it } from "vitest";
import { canMergeHistorySnapshot, type RawMessagePage } from "./chatHistoryCache";

function page(start: number, total: number, messages: unknown[]): RawMessagePage { return { start, total, messages }; }

describe("canMergeHistorySnapshot", () => {
  it("retains previously loaded pages when the snapshot overlaps the same growing history", () => {
    expect(canMergeHistorySnapshot(page(0, 3, ["a", "b", "c"]), page(2, 4, ["c", "d"]))).toBe(true);
  });

  it("replaces a partial cache when the authoritative total shrinks, even with matching overlap", () => {
    expect(canMergeHistorySnapshot(page(2, 8, ["c", "d", "e", "f", "g", "h"]), page(3, 6, ["d", "e", "f"]))).toBe(false);
  });

  it.each([6, 7])("rejects a different branch with a non-decreasing total (%s)", (total) => {
    const snapshot = page(4, total, Array.from({ length: total - 4 }, (_, index) => `new-${String(index)}`));
    expect(canMergeHistorySnapshot(page(2, 6, ["c", "d", "old-e", "old-f"]), snapshot)).toBe(false);
  });

  it("does not infer branch continuity from adjacent non-overlapping pages", () => {
    expect(canMergeHistorySnapshot(page(0, 2, ["a", "b"]), page(2, 4, ["c", "d"]))).toBe(false);
  });

  it("can merge an empty cache without needing an overlap", () => {
    expect(canMergeHistorySnapshot(page(0, 0, []), page(0, 0, []))).toBe(true);
    expect(canMergeHistorySnapshot(page(0, 0, []), page(2, 4, ["c", "d"]))).toBe(true);
  });

  it("does not trust an invalid cached raw range", () => {
    expect(canMergeHistorySnapshot(page(0, 1, ["a", "b"]), page(0, 2, ["a", "b"]))).toBe(false);
  });
});

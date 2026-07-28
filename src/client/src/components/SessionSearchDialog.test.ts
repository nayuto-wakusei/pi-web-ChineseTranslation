import { describe, expect, it } from "vitest";
import { sessionSearchExcerptSegments } from "./SessionSearchDialog";

describe("session search result highlighting", () => {
  it("renders every supplied match range without losing surrounding text", () => {
    expect(sessionSearchExcerptSegments({
      text: "alpha beta beta omega",
      matchRanges: [{ start: 6, length: 4 }, { start: 11, length: 4 }],
    })).toEqual([
      { text: "alpha ", highlighted: false },
      { text: "beta", highlighted: true },
      { text: " ", highlighted: false },
      { text: "beta", highlighted: true },
      { text: " omega", highlighted: false },
    ]);
  });

  it("clamps malformed overlapping ranges at the previous match boundary", () => {
    expect(sessionSearchExcerptSegments({
      text: "abcdef",
      matchRanges: [{ start: -2, length: 4 }, { start: 1, length: 4 }],
    })).toEqual([
      { text: "ab", highlighted: true },
      { text: "cde", highlighted: true },
      { text: "f", highlighted: false },
    ]);
  });
});

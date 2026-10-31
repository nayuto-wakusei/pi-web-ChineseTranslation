import { describe, expect, it } from "vitest";
import { findMatchRanges, searchSessionContent } from "./sessionContentSearch.js";

describe("session content search", () => {
  it("returns user and assistant message matches with stable transcript indices", () => {
    const messages = [
      { role: "system", content: "needle" },
      { role: "user", content: "Needle in the question" },
      { role: "assistant", content: [{ type: "thinking", thinking: "needle" }, { type: "text", text: "answer NEEDLE" }] },
      { role: "toolResult", content: "needle" },
      { role: "assistant", content: [{ type: "thinking", thinking: "needle" }] },
    ];

    expect(searchSessionContent(messages, "needle", 20)).toEqual({
      matchCount: 2,
      matches: [
        expect.objectContaining({ messageIndex: 2, role: "assistant", occurrenceCount: 1 }),
        expect.objectContaining({ messageIndex: 1, role: "user", occurrenceCount: 1 }),
      ],
    });
  });

  it("keeps multiple occurrences and merges nearby excerpts", () => {
    const text = `prefix needle middle needle suffix ${"x".repeat(180)} final needle`;
    const result = searchSessionContent([{ role: "user", content: text }], "needle", 20);
    const match = result.matches[0];

    expect(match?.occurrenceCount).toBe(3);
    expect(match?.excerpts).toHaveLength(2);
    expect(match?.excerpts.flatMap((excerpt) => excerpt.matchRanges)).toHaveLength(3);
  });

  it("finds non-overlapping case-insensitive ranges", () => {
    expect(findMatchRanges("One one ONE", "one")).toEqual([
      { start: 0, length: 3 },
      { start: 4, length: 3 },
      { start: 8, length: 3 },
    ]);
    expect(findMatchRanges("\ud83d\ude00 a+b A+B", "a+b")).toEqual([{ start: 3, length: 3 }, { start: 7, length: 3 }]);
    expect(searchSessionContent([{ role: "user", content: "\ud83d\ude00 + \ud83d\ude00" }], "\ud83d\ude00", 20).matches[0]?.excerpts[0]?.matchRanges).toEqual([{ start: 0, length: 2 }, { start: 5, length: 2 }]);
    expect(searchSessionContent([{ role: "user", content: "" }], "+", 20).matchCount).toBe(0);
    expect(searchSessionContent([{ role: "user", content: "anything" }], "  ", 20).matchCount).toBe(0);
  });

  it("ranks phrases before all-keyword and bounded typo matches without losing transcript offsets", () => {
    const messages = [
      { role: "user", content: "\ud83d\ude00 Deploy SERVER" },
      { role: "assistant", content: [{ type: "text", text: "server" }, { type: "text", text: "then deploy" }] },
      { role: "user", content: "deploy the servr" },
      { role: "user", content: "deploy only" },
      { role: "user", content: "deploy the svr" },
    ];
    const result = searchSessionContent(messages, "deploy server", 20);
    expect(result.matchCount).toBe(3);
    expect(result.matches.map(({ messageIndex, rank }) => [messageIndex, rank])).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(result.matches.flatMap(({ excerpts }) => excerpts.flatMap(({ text, matchRanges }) => matchRanges.map(({ start, length }) => text.slice(start, start + length))))).toEqual(["Deploy SERVER", "server", "deploy", "deploy", "servr"]);
    expect(searchSessionContent(messages, "deploy server", 1).matches[0]?.messageIndex).toBe(0);
    expect(searchSessionContent([{ role: "user", content: "\u90e8\u7f72\u6210\u529f\uff0c\u670d\u52a1\u5668\u5c31\u7eea" }], "\u670d\u52a1\u5668 \u90e8\u7f72", 20).matchCount).toBe(1);
    expect(searchSessionContent([{ role: "user", content: "cat" }], "car", 20).matchCount).toBe(0);
    expect(searchSessionContent([{ role: "user", content: "\u670d\u52a1\u5668" }], "\u670d\u52a1\u7aef", 20).matchCount).toBe(0);
  });
});

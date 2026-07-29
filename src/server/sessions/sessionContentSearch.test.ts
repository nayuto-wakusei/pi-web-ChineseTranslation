import { describe, expect, it } from "vitest";
import { findMatchRanges, searchSessionContent } from "./sessionContentSearch.js";

describe("session content search", () => {
  it("returns user and assistant message matches with stable transcript indices", () => {
    const messages = [
      { role: "system", content: "needle" },
      { role: "user", content: "Needle in the question" },
      { role: "assistant", content: [{ type: "thinking", thinking: "needle" }, { type: "text", text: "answer NEEDLE" }] },
      { role: "toolResult", content: "needle" },
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
  });
});

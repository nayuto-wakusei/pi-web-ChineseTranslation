import { describe, expect, it } from "vitest";
import type { SessionTreeSummaryPresentation } from "./apiTypes.js";
import { parseSessionTreeSummaryPresentation } from "./sessionTreeSummaryPresentation.js";

const parts = [{ type: "text", text: "Literal Tool error [image] العربية" }, { type: "image" }] as const;

describe("parseSessionTreeSummaryPresentation", () => {
  it("preserves all supported variants and strips unrelated fields", () => {
    const presentations: SessionTreeSummaryPresentation[] = [
      ...(["message", "user-message", "assistant-response", "assistant-error", "assistant-aborted", "hidden-custom-message", "compaction-summary", "branch-summary"] as const)
        .map((status) => ({ type: "status" as const, status })),
      { type: "content", parts: [...parts], fallback: "user-message" },
      { type: "content", parts: [], fallback: "assistant-response" },
      ...(["shell", "model", "thinking-level", "session-name", "label", "custom-entry", "entry"] as const)
        .flatMap((field): SessionTreeSummaryPresentation[] => [{ type: "named", field }, { type: "named", field, value: "literal" }]),
      { type: "assistant-tools", names: ["read", "bash", "edit"] },
      { type: "assistant-tools", names: [] },
      { type: "tool-result", isError: true, toolName: "bash", parts: [...parts] },
      { type: "tool-result", isError: false, parts: [] },
      { type: "custom-message", customType: "notice", parts: [...parts] },
      { type: "custom-message", parts: [] },
    ];
    for (const presentation of presentations) {
      expect(parseSessionTreeSummaryPresentation({ ...presentation, futureMetadata: true })).toEqual(presentation);
    }
    expect(parseSessionTreeSummaryPresentation({ type: "content", parts: [{ type: "image", data: "discard" }, { type: "text", text: "literal", private: true }], fallback: "message" }))
      .toEqual({ type: "content", parts: [{ type: "image" }, { type: "text", text: "literal" }], fallback: "message" });
  });

  it.each([
    undefined, null, false, "status", [], {}, { type: "future" },
    { type: "status", status: "future" },
    { type: "content", parts: [], fallback: "future" },
    { type: "content", fallback: "message" },
    { type: "content", parts: [null], fallback: "message" },
    { type: "content", parts: [{ type: "audio" }], fallback: "message" },
    { type: "content", parts: [{ type: "text", text: 1 }], fallback: "message" },
    { type: "named", field: "future", value: "literal" },
    { type: "named", field: "label", value: null },
    { type: "assistant-tools", names: "read" },
    { type: "assistant-tools", names: ["read", 1] },
    { type: "tool-result", parts: [], isError: "yes" },
    { type: "tool-result", parts: [], isError: false, toolName: 1 },
    { type: "tool-result", parts: [{ type: "future" }], isError: false },
    { type: "custom-message", parts: [], customType: false },
    { type: "custom-message", parts: null },
  ])("omits unsupported or malformed metadata: %j", (value) => {
    expect(parseSessionTreeSummaryPresentation(value)).toBeUndefined();
  });

  it("accepts projection-sized metadata and rejects oversized metadata without truncating it", () => {
    const content = (parts: unknown[]) => ({ type: "content", parts, fallback: "message" });
    expect(parseSessionTreeSummaryPresentation(content([{ type: "text", text: "a".repeat(720) }]))).toBeDefined();
    // The projector may append an image when fewer than seven source characters remain.
    expect(parseSessionTreeSummaryPresentation(content([{ type: "text", text: "a".repeat(719) }, { type: "image" }]))).toBeDefined();
    expect(parseSessionTreeSummaryPresentation(content(Array.from({ length: 720 }, () => ({ type: "text", text: "a" }))))).toBeDefined();
    expect(parseSessionTreeSummaryPresentation({ type: "named", field: "model", value: "m".repeat(161) })).toBeDefined();
    for (const value of [
      content([{ type: "text", text: "a".repeat(721) }]),
      content([{ type: "text", text: "a".repeat(400) }, { type: "text", text: "b".repeat(400) }]),
      content(Array.from({ length: 721 }, () => ({ type: "text", text: "" }))),
      { type: "named", field: "model", value: "m".repeat(162) },
      { type: "named", field: "shell", value: "s".repeat(81) },
      { type: "assistant-tools", names: ["one", "two", "three", "four"] },
      { type: "assistant-tools", names: ["n".repeat(81)] },
      { type: "tool-result", isError: false, parts: [], toolName: "n".repeat(81) },
      { type: "custom-message", parts: [], customType: "n".repeat(81) },
    ]) expect(parseSessionTreeSummaryPresentation(value)).toBeUndefined();
  });
});

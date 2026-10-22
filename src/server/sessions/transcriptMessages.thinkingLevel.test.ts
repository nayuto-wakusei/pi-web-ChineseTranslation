import { describe, expect, it } from "vitest";
import { annotateAssistantThinkingLevel, historyMessagesFromEntries } from "./transcriptMessages.js";

describe("physical assistant thinking level", () => {
  it.each(["low", "off"])("preserves Pi's physical thinking level %s over the selected fallback", (thinkingLevel) => {
    const message = { role: "assistant", content: "answer", thinkingLevel };
    expect(annotateAssistantThinkingLevel(message, "high")).toBe(message);
    const [historical] = historyMessagesFromEntries([
      { type: "thinking_level_change", thinkingLevel: "high" },
      { type: "message", id: "assistant-1", message },
    ]);
    expect(historical).toMatchObject({ thinkingLevel, entryId: "assistant-1" });
  });

  it.each([undefined, "", 42])("uses the selected level only when no physical string is recorded: %s", (thinkingLevel) => {
    const message = { role: "assistant", content: "answer", thinkingLevel };
    expect(annotateAssistantThinkingLevel(message, "medium")).toEqual({ ...message, thinkingLevel: "medium" });
    expect(message.thinkingLevel).toBe(thinkingLevel);
  });
});

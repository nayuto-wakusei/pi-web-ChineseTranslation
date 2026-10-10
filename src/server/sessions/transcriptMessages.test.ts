import { describe, expect, it } from "vitest";
import { historyMessagesFromEntries } from "./transcriptMessages.js";

describe("durable transcript entry ids", () => {
  it("removes provider navigation ids when the enclosing entry is not persisted", () => {
    const message = { role: "user", content: "draft", entryId: "not-durable" };
    const history = historyMessagesFromEntries([{ type: "message", message }, { type: "message", id: "", message }]);
    expect(history).toEqual([{ role: "user", content: "draft" }, { role: "user", content: "draft" }]);
    expect(message.entryId).toBe("not-durable");
  });
  it("uses the enclosing entry id and ignores a provider id on the message", () => {
    const history = historyMessagesFromEntries([
      { type: "message", id: "entry-user", message: { role: "user", content: "hello", entryId: "provider-id" } },
      { type: "thinking_level_change", thinkingLevel: "high" },
      { type: "message", id: "entry-assistant", message: { role: "assistant", content: "answer" } },
      { type: "message", message: { role: "user", content: "unsaved" } },
      { type: "compaction", id: "entry-summary", summary: "short" },
    ]);

    expect(history[0]).toMatchObject({ role: "user", entryId: "entry-user" });
    expect(history[0]).not.toMatchObject({ entryId: "provider-id" });
    expect(history[1]).toMatchObject({ role: "assistant", entryId: "entry-assistant", thinkingLevel: "high" });
    expect(history[2]).not.toHaveProperty("entryId");
    expect(history[3]).toMatchObject({ role: "system", source: "compaction", entryId: "entry-summary" });
  });
});

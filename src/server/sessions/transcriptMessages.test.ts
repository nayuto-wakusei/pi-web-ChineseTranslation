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
import { pageMessagesAtSafeBoundary } from "./messagePaging.js";
import { projectBrowserMessageResponse } from "../browserMessageProjection.js";
import { parseMessagePage } from "../../client/src/api/parsers.js";
import { normalizeMessages } from "../../client/src/chatMessages.js";

describe("durable transcript identity", () => {
  it("propagates entry IDs through paging, browser projection, API parsing and ChatLine mapping", () => {
    const entries = [
      { type: "message", id: "user-1", message: { role: "user", content: "hello" } },
      { type: "thinking_level_change", id: "level-1", thinkingLevel: "high" },
      { type: "message", id: "assistant-1", message: { role: "assistant", id: "provider-id", entryId: "not-authoritative", content: "answer" } },
      { type: "custom_message", id: "hidden", display: false, content: "hidden" },
      { type: "custom_message", id: "custom-1", display: true, content: "notice" },
      { type: "compaction", id: "compact-1", summary: "compact" },
      { type: "branch_summary", id: "branch-1", summary: "branch" },
      { type: "message", id: "user-2", message: { role: "user", content: "next" } },
      { type: "message", id: "bash-1", message: { role: "bashExecution", command: "pwd", output: "/repo" } },
    ];
    const original = structuredClone(entries);
    const messages = historyMessagesFromEntries(entries);
    const linesForPage = (before?: number, limit?: number) => normalizeMessages(parseMessagePage(
      projectBrowserMessageResponse(pageMessagesAtSafeBoundary(messages, { ...(before === undefined ? {} : { before }), ...(limit === undefined ? {} : { limit }) })),
    ).messages);

    expect(linesForPage().map((line) => line.entryId)).toEqual([
      "user-1", "assistant-1", "custom-1", "compact-1", "branch-1", "user-2", "bash-1",
    ]);
    expect(linesForPage(5, 1).map((line) => line.entryId)).toEqual([
      "user-1", "assistant-1", "custom-1", "compact-1", "branch-1",
    ]);
    expect(linesForPage()[1]?.meta?.thinkingLevel).toBe("high");
    expect(historyMessagesFromEntries(entries)).toEqual(messages);
    expect(entries).toEqual(original);
  });

  it("does not invent IDs for entries without durable identity", () => {
    const messages = historyMessagesFromEntries([
      { type: "message", message: { role: "user", id: "provider", entryId: "untrusted", content: "legacy" } },
      { type: "message", id: "", message: { role: "assistant", content: "answer" } },
    ]);
    expect(messages).toEqual([{ role: "user", id: "provider", content: "legacy" }, { role: "assistant", content: "answer" }]);
    expect(normalizeMessages(messages).every((line) => !("entryId" in line))).toBe(true);
  });
});

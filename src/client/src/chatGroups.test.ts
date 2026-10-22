import { describe, expect, it } from "vitest";
import { groupChatMessages, summarizeChatGroup } from "./chatGroups";
import type { ChatLine } from "./components/shared";
import type { ChatLine as HistoryChatLine } from "./components/shared";

const text = (role: ChatLine["role"], value: string): ChatLine => ({ role, parts: [{ type: "text", text: value }] });

describe("groupChatMessages", () => {
  it("preserves durable entry IDs in readable and technical groups", () => {
    const messages: HistoryChatLine[] = [
      { ...text("user", "question"), entryId: "user-entry" },
      { role: "assistant", entryId: "assistant-entry", parts: [{ type: "thinking", text: "plan" }, { type: "text", text: "answer" }] },
    ];
    expect(groupChatMessages(messages)).toMatchObject([
      { kind: "message", message: { entryId: "user-entry" } },
      { kind: "group", messages: [{ index: 1, message: { entryId: "assistant-entry" } }] },
      { kind: "message", message: { entryId: "assistant-entry" } },
    ]);
  });

  it("groups technical parts until a readable message is encountered", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "thinking", text: "plan" }, { type: "toolCall", toolName: "read", summary: "file" }] },
      text("assistant", "visible answer"),
      { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "ok", isError: false }] },
    ];

    expect(groupChatMessages(messages, 10)).toEqual([
      { kind: "group", startIndex: 10, endIndex: 10, messages: [{ index: 10, message: messages[0] }] },
      { kind: "message", index: 11, message: text("assistant", "visible answer") },
      { kind: "group", startIndex: 12, endIndex: 12, messages: [{ index: 12, message: messages[2] }] },
    ]);
  });

  it("keeps invisible chronology markers out of visual grouping and preserves absolute end indexes", () => {
    const first: ChatLine = { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "first", isError: false }] };
    const last: ChatLine = { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "last", isError: false }] };
    expect(groupChatMessages([
      first,
      { role: "tool", parts: [{ type: "toolResultBoundary", toolCallId: "first" }] },
      { role: "assistant", parts: [{ type: "empty" }] },
      last,
    ], 10)).toEqual([
      { kind: "group", startIndex: 10, endIndex: 13, messages: [{ index: 10, message: first }, { index: 13, message: last }] },
    ]);
  });

  it("splits mixed readable and technical parts from a single message", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "thinking", text: "hidden" }, { type: "text", text: "shown" }] },
    ];

    expect(groupChatMessages(messages)).toEqual([
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ index: 0, message: { role: "assistant", parts: [{ type: "thinking", text: "hidden" }] } }] },
      { kind: "message", index: 0, message: { role: "assistant", parts: [{ type: "text", text: "shown" }] } },
    ]);
  });

  it("keeps skill reads out of event groups", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "thinking", text: "plan" }, { type: "skillRead", name: "playwright", path: "/skills/playwright/SKILL.md" }] },
    ];

    expect(groupChatMessages(messages)).toEqual([
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ index: 0, message: { role: "assistant", parts: [{ type: "thinking", text: "plan" }] } }] },
      { kind: "message", index: 0, message: { role: "skill", parts: [{ type: "skillRead", name: "playwright", path: "/skills/playwright/SKILL.md" }] } },
    ]);
  });

  it("keeps image content visible outside collapsed event groups", () => {
    const image = { type: "image" as const, mimeType: "image/png", data: "QUJD" };
    const messages: ChatLine[] = [
      { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "Read image file [image/png]", isError: false }, image] },
    ];

    expect(groupChatMessages(messages)).toEqual([
      {
        kind: "group",
        startIndex: 0,
        endIndex: 0,
        messages: [{ index: 0, message: { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "Read image file [image/png]", isError: false }] } }],
      },
      { kind: "tool-image", index: 0, message: { role: "tool", parts: [image] }, toolName: "read" },
    ]);
  });

  it("preserves image metadata when splitting technical and readable parts", () => {
    const meta = { timestamp: "2026-07-13T22:00:00.000Z" };
    const image = { type: "image" as const, mimeType: "image/webp", data: "QUJD" };
    const message: ChatLine = { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "ok", isError: false }, image], meta };

    expect(groupChatMessages([message])).toEqual([
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ index: 0, message: { role: "tool", parts: [message.parts[0]], meta } }] },
      { kind: "tool-image", index: 0, message: { role: "tool", parts: [image], meta }, toolName: "read" },
    ]);
  });

  it("keeps user images as ordinary messages", () => {
    const image = { type: "image" as const, mimeType: "image/png", data: "QUJD" };
    const message: ChatLine = { role: "user", parts: [image] };

    expect(groupChatMessages([message])).toEqual([
      { kind: "message", index: 0, message },
    ]);
  });

  it("preserves message metadata when grouping", () => {
    const message: ChatLine = { role: "assistant", parts: [{ type: "thinking", text: "hidden" }, { type: "text", text: "shown" }], meta: { timestamp: "2026-05-09T12:00:00.000Z", model: { provider: "test", id: "model" } } };

    expect(groupChatMessages([message])).toEqual([
      { kind: "group", startIndex: 0, endIndex: 0, messages: [{ index: 0, message: { role: "assistant", parts: [{ type: "thinking", text: "hidden" }], meta: message.meta } }] },
      { kind: "message", index: 0, message: { role: "assistant", parts: [{ type: "text", text: "shown" }], meta: message.meta } },
    ]);
  });

  it("treats compaction and branch summaries as grouped events", () => {
    const messages: ChatLine[] = [
      { ...text("assistant", "summary"), source: "compaction" },
      { ...text("assistant", "branch"), source: "branch_summary" },
    ];

    const groups = groupChatMessages(messages);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "group", startIndex: 0, endIndex: 1 });
  });

  it("keeps a stable group end index when older events are prepended into a group", () => {
    expect(groupChatMessages([
      { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "older", isError: false }] },
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "newer" }] },
      text("assistant", "answer"),
    ], 8)[0]).toMatchObject({ kind: "group", startIndex: 8, endIndex: 9 });
  });
});

describe("summarizeChatGroup", () => {
  it("summarizes special event groups", () => {
    expect(summarizeChatGroup([{ ...text("assistant", "a"), source: "compaction" }])).toBe("1 条历史压缩摘要");
    expect(summarizeChatGroup([
      { ...text("assistant", "a"), source: "branch_summary" },
      { ...text("assistant", "b"), source: "branch_summary" },
    ])).toBe("2 条分支摘要");
  });

  it("summarizes mixed groups by role counts", () => {
    expect(summarizeChatGroup([text("tool", "a"), text("system", "b"), text("tool", "c")])).toBe("3 个事件 · 2 工具 · 1 系统");
  });
});

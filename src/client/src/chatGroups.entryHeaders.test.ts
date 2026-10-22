import { describe, expect, it } from "vitest";
import { canonicalEntryActionHeaders, groupChatMessages, type ChatGroup } from "./chatGroups";
import type { ChatLine } from "./components/shared";

const text = (role: ChatLine["role"], value: string): ChatLine => ({ role, parts: [{ type: "text", text: value }] });

function renderedMessages(groups: readonly ChatGroup[]): ChatLine[] {
  return groups.flatMap((group) => group.kind === "group" ? group.messages.map(({ message }) => message) : [group.message]);
}

describe("canonicalEntryActionHeaders", () => {
  it.each(["user", "assistant"] as const)("prefers the readable %s reply over attached technical parts using rendered identities", (role) => {
    const source: ChatLine = { role, entryId: "entry", parts: [{ type: "thinking", text: "plan" }, { type: "text", text: "reply" }] };
    const groups = groupChatMessages([source], 20);
    const slices = renderedMessages(groups);
    const selected = canonicalEntryActionHeaders(groups);

    expect(selected.size).toBe(1);
    expect([...selected][0]).toBe(slices[1]);
    expect(selected.has(source)).toBe(false);
    expect(groups).toHaveLength(2);
    expect(source.parts).toHaveLength(2);
  });

  it("retains a distinct thinking-only entry even when another entry has a reply", () => {
    const groups = groupChatMessages([
      { role: "assistant", entryId: "thinking", parts: [{ type: "thinking", text: "checkpoint" }] },
      { ...text("assistant", "answer"), entryId: "reply" },
    ]);
    const slices = renderedMessages(groups);

    expect([...canonicalEntryActionHeaders(groups)]).toEqual(slices);
  });

  it.each([false, true])("prefers an assistant thinking header over a shared skill-only header (skill first: %s)", (skillFirst) => {
    const thinking: ChatLine = { role: "assistant", entryId: "shared", parts: [{ type: "thinking", text: "checkpoint" }] };
    const skill: ChatLine = { role: "assistant", entryId: "shared", parts: [{ type: "skillRead", name: "example", path: "/skills/example/SKILL.md" }] };
    const groups = groupChatMessages(skillFirst ? [skill, thinking] : [thinking, skill]);
    const slices = renderedMessages(groups);

    expect([...canonicalEntryActionHeaders(groups)]).toEqual(slices.filter((message) => message.role === "assistant"));
    expect(slices.some((message) => message.role === "skill")).toBe(true);
  });

  it("selects a reply after shared skill/thinking slices and keeps stable first-header ties", () => {
    const groups = groupChatMessages([
      { role: "assistant", entryId: "assistant", parts: [{ type: "thinking", text: "plan" }, { type: "skillRead", name: "example", path: "/skills/example/SKILL.md" }] },
      { ...text("assistant", "reply"), entryId: "assistant" },
      { ...text("assistant", "another slice"), entryId: "assistant" },
      { role: "user", entryId: "user", parts: [{ type: "skillInvocation", name: "example", location: "/skills/example", content: "instructions" }] },
      { ...text("user", "request"), entryId: "user" },
      { ...text("user", "another request slice"), entryId: "user" },
      { role: "skill", entryId: "skill-only", parts: [{ type: "skillRead", name: "example", path: "/skills/example/SKILL.md" }] },
      { role: "assistant", entryId: "assistant", parts: [{ type: "thinking", text: "later technical slice" }] },
    ]);
    const slices = renderedMessages(groups);

    const selected = [...canonicalEntryActionHeaders(groups)];
    expect(selected).toHaveLength(3);
    expect(selected[0]).toBe(slices[1]);
    expect(selected[0]).toMatchObject({ entryId: "assistant", parts: [{ type: "text", text: "reply" }] });
    expect(selected[1]).toBe(slices[4]);
    expect(selected[1]).toMatchObject({ entryId: "user", parts: [{ type: "text", text: "request" }] });
    expect(selected[2]).toBe(slices[6]);
    expect(selected[2]).toMatchObject({ entryId: "skill-only", role: "skill" });
  });

  it("selects the rendered tool-image header over its technical result", () => {
    const groups = groupChatMessages([{ role: "tool", entryId: "image", parts: [
      { type: "toolResult", toolName: "read", text: "image result", isError: false },
      { type: "image", mimeType: "image/png", data: "QUJD" },
    ] }]);

    expect([...canonicalEntryActionHeaders(groups)]).toEqual([renderedMessages(groups)[1]]);
  });

  it("skips headerless tool/ask shells and entryless slices without letting them steal a shared entry", () => {
    const execution: ChatLine = { role: "tool", parts: [{ type: "toolExecution", toolName: "read", summary: "file", status: "success" }] };
    const ask: ChatLine = { role: "tool", parts: [{ type: "askUserRecord", outcome: {
      askId: "ask", reason: "submitted", askedAt: "2026-07-20T10:00:00.000Z", closedAt: "2026-07-20T10:01:00.000Z",
      questions: [], answeredCount: 0, unansweredIds: [], summary: "No answers",
    } }] };
    const groups = groupChatMessages([
      { ...execution, entryId: "shared" },
      { ...ask, entryId: "shared" },
      { role: "tool", entryId: "shared", parts: [{ type: "toolResult", toolName: "read", text: "legacy result", isError: false }] },
      { ...execution, entryId: "tool-only" },
      { ...ask, entryId: "ask-only" },
      text("assistant", "streaming"),
    ]);
    const slices = renderedMessages(groups);

    expect([...canonicalEntryActionHeaders(groups)]).toEqual([slices[2]]);
    expect(canonicalEntryActionHeaders([]).size).toBe(0);
  });
});

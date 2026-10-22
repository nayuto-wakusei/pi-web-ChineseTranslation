import { describe, expect, it } from "vitest";
import { normalizeMessages } from "./chatMessages";
import { applyTranscriptEvent, seedStreamingPartial } from "./chatTranscript";

const finalAssistant = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "plan" },
    { type: "text", text: "answer" },
  ],
  timestamp: "2026-05-09T12:00:00.000Z",
  provider: "test",
  model: "model",
};

describe("assistant stream identity", () => {
  const start = { ...finalAssistant, streamId: "stream-1", content: [] };
  const toolStart = { type: "tool.start" as const, toolCallId: "call-1", toolName: "bash", summary: "pwd" };

  it.each(["assistant.delta", "assistant.thinking.delta"] as const)("reconciles %s in place across an intervening tool", (type) => {
    let messages = applyTranscriptEvent([], { type: "assistant.start", message: start }) ?? [];
    messages = applyTranscriptEvent(messages, { type, streamId: start.streamId, text: "first" }) ?? messages;
    expect(messages[0]?.meta).toEqual(normalizeMessages([finalAssistant])[0]?.meta);
    messages = applyTranscriptEvent(messages, toolStart) ?? messages;
    messages = applyTranscriptEvent(messages, { type, streamId: start.streamId, text: " second" }) ?? messages;
    expect(messages[0]?.parts).toEqual([{ type: type === "assistant.delta" ? "text" : "thinking", text: "first second" }]);
    const final = { ...start, content: type === "assistant.delta"
      ? [{ type: "text", text: "authoritative" }]
      : [{ type: "thinking", thinking: "authoritative" }] };
    const tool = messages[1];
    messages = applyTranscriptEvent(messages, { type: "message.end", message: final }) ?? messages;
    expect(messages).toEqual([...normalizeMessages([final]), tool]);
    expect(applyTranscriptEvent(messages, { type: "message.end", message: final })).toEqual(messages);
  });

  it("keeps separate assistant messages distinct even with identical text and no tool between them", () => {
    const first = { ...start, content: [{ type: "text", text: "same" }] };
    let messages = applyTranscriptEvent([], { type: "message.end", message: first }) ?? [];
    const second = { ...start, streamId: "stream-2" };
    messages = applyTranscriptEvent(messages, { type: "assistant.start", message: second }) ?? messages;
    messages = applyTranscriptEvent(messages, { type: "assistant.delta", streamId: second.streamId, text: "same" }) ?? messages;
    const final = { ...second, content: first.content };
    messages = applyTranscriptEvent(messages, { type: "message.end", message: final }) ?? messages;
    expect(messages).toEqual(normalizeMessages([first, final]));
  });

  it("retains snapshot identity across tool-call projection, streaming, and finalization", () => {
    const partial = { ...start, content: [
      { type: "text", text: "before" },
      { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } },
    ] };
    let messages = seedStreamingPartial([], partial);
    messages = applyTranscriptEvent(messages, { type: "assistant.delta", streamId: start.streamId, text: " after" }) ?? messages;
    expect(messages[0]?.parts).toEqual([{ type: "text", text: "before after" }]);
    const final = { ...start, content: [{ type: "text", text: "before after" }, partial.content[1]] };
    messages = applyTranscriptEvent(messages, { type: "message.end", message: final }) ?? messages;
    expect(messages).toEqual(normalizeMessages([final]));
  });

  it("keeps identity when joining an empty stream or a tool-call-only partial", () => {
    for (const content of [[], [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }]]) {
      let messages = seedStreamingPartial([], { ...start, content });
      messages = applyTranscriptEvent(messages, { ...toolStart, toolCallId: "call-2" }) ?? messages;
      messages = applyTranscriptEvent(messages, { type: "assistant.delta", streamId: start.streamId, text: "answer" }) ?? messages;
      expect(messages.filter((line) => line.role === "assistant")).toEqual([
        { ...normalizeMessages([{ ...start, content: [{ type: "text", text: "answer" }] }])[0] },
      ]);
    }
  });

  it("removes an empty provisional assistant on finalization without removing its tool", () => {
    let messages = applyTranscriptEvent([], { type: "assistant.start", message: start }) ?? [];
    messages = applyTranscriptEvent(messages, toolStart) ?? messages;
    const tool = messages[1];
    expect(applyTranscriptEvent(messages, { type: "message.end", message: start })).toEqual([tool]);
    const toolOnlyFinal = { ...start, content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }] };
    expect(applyTranscriptEvent(messages, { type: "message.end", message: toolOnlyFinal })).toEqual([tool]);
  });

  it.each([true, false])("reconciles identified skill reads without duplicating the streamed skill row (thinking: %s)", (thinking) => {
    const parts = thinking ? [{ type: "thinking", thinking: "load skill" }] : [];
    const final = { ...start, content: [...parts,
      { type: "toolCall", id: "skill-1", name: "read", arguments: { path: "/skills/playwright/SKILL.md" } },
    ] };
    let messages = applyTranscriptEvent([], { type: "assistant.start", message: start }) ?? [];
    if (thinking) messages = applyTranscriptEvent(messages, { type: "assistant.thinking.delta", streamId: start.streamId, text: "load skill" }) ?? messages;
    messages = applyTranscriptEvent(messages, { type: "tool.start", toolName: "read", toolCallId: "skill-1", summary: "read skill", args: { path: "/skills/playwright/SKILL.md" } }) ?? messages;
    messages = applyTranscriptEvent(messages, { type: "message.end", message: final }) ?? messages;
    expect(messages).toEqual(normalizeMessages([final]));
    expect(applyTranscriptEvent(messages, { type: "message.end", message: final })).toEqual(messages);
  });

  it("does not append an identified delta to a neighboring message if start was unavailable", () => {
    const history = normalizeMessages([finalAssistant]);
    const messages = applyTranscriptEvent(history, { type: "assistant.delta", streamId: "new", text: "new" });
    expect(messages).toEqual([...history, { role: "assistant", streamId: "new", parts: [{ type: "text", text: "new" }] }]);
  });
});

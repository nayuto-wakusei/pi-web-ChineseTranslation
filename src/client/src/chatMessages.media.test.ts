import { expect, it } from "vitest";
import { appendText, appendThinking, normalizeMessage, normalizeMessages, textMessage } from "./chatMessages";
import { applyTranscriptEvent, seedStreamingPartial } from "./chatTranscript";
import type { ChatLine } from "./components/shared";

const legacyImageReference = { type: "image" as const, mediaId: "0123456789abcdef".repeat(4), mimeType: "image/png", byteSize: 3 };
const imageReference = { ...legacyImageReference, width: 1200, height: 800 };

it.each(["visible", "", undefined, 42])("preserves original text and optional string display text (%s)", (displayText) => {
  const display = typeof displayText === "string" ? { displayText } : {};
  expect(normalizeMessages([{ role: "assistant", content: [
    { type: "text", text: "original", displayText },
    { type: "thinking", thinking: "reasoning", displayText },
    { type: "thinking", text: "fallback reasoning", displayText },
  ] }])).toEqual([{ role: "assistant", parts: [
    { type: "text", text: "original", ...display },
    { type: "thinking", text: "reasoning", ...display },
    { type: "thinking", text: "fallback reasoning", ...display },
  ] }]);
  expect(normalizeMessages([{ role: "user", content: "original", displayText }])).toEqual([
    { role: "user", parts: [{ type: "text", text: "original", ...display }] },
  ]);
});

it("drops stale display overrides when original text resumes streaming", () => {
  expect(appendText([{ role: "assistant", parts: [{ type: "text", text: "original", displayText: "display" }] }], "assistant", " delta")).toEqual([
    { role: "assistant", parts: [{ type: "text", text: "original delta" }] },
  ]);
  expect(appendThinking([{ role: "assistant", parts: [{ type: "thinking", text: "original", displayText: "display" }] }], " delta")).toEqual([
    { role: "assistant", parts: [{ type: "thinking", text: "original delta" }] },
  ]);
});

it("preserves references without copying base64 or server-supplied URLs", () => {
    const raw = { role: "user", entryId: "image-entry", content: [{ ...imageReference, data: "QUJD", url: "https://remote.test/not-the-proxy" }] };
    const normalized = normalizeMessages([raw]);
    expect(normalized).toEqual([{ role: "user", entryId: "image-entry", parts: [imageReference] }]);
    expect(normalizeMessages(normalized)).toEqual(normalized);
  });

it("keeps older references without dimensions usable", () => {
    expect(normalizeMessages([{ role: "user", content: [legacyImageReference] }]))
      .toEqual([{ role: "user", parts: [legacyImageReference] }]);
  });

it("preserves inline dimension hints through normalization and cached chat lines", () => {
    const inline = { type: "image" as const, mimeType: "image/png", data: "QUJD", width: 400, height: 1600 };
    const normalized = normalizeMessages([{ role: "user", content: [inline] }]);
    expect(normalized).toEqual([{ role: "user", parts: [inline] }]);
    expect(normalizeMessages(normalized)).toEqual(normalized);
  });

it.each([
    { width: undefined }, { height: undefined }, { width: 0 }, { height: 0 },
    { width: -1 }, { height: -1 }, { width: 1.5 }, { height: 1.5 },
    { width: Infinity }, { height: Infinity }, { width: "1200" }, { height: null },
    { width: Number.MAX_SAFE_INTEGER + 1 },
  ])("drops invalid dimension pairs without discarding the image: %j", (invalid) => {
    const normalized = normalizeMessages([{ role: "user", content: [{ ...imageReference, ...invalid }] }]);
    expect(normalized).toEqual([{ role: "user", parts: [legacyImageReference] }]);
    expect(normalizeMessages(normalized)).toEqual(normalized);
  });

it.each([
    { mediaId: "A".repeat(64) }, { mediaId: "a".repeat(63) }, { mediaId: "a".repeat(65) },
    { mediaId: "../file.png" }, { mediaId: 42 }, { mediaId: null }, { mediaId: `${"a".repeat(64)}\n` },
    { mimeType: "text/html" }, { mimeType: "" }, { mimeType: null }, { mimeType: "image/png\n" },
    { byteSize: -1 }, { byteSize: 1.5 }, { byteSize: Infinity }, { byteSize: "3" }, { byteSize: undefined },
  ])("fails closed for a malformed image reference: %j", (invalid) => {
    expect(normalizeMessage({ role: "user", content: [{ ...imageReference, ...invalid, data: "QUJD" }] }))
      .toEqual([textMessage("user", "[image]")]);
  });

it("also validates image references in already-shaped cached chat lines", () => {
    expect(normalizeMessage({ role: "user", entryId: "cached-image", parts: [{ ...imageReference, mediaId: "invalid", data: "QUJD" }] }))
      .toEqual([{ role: "user", entryId: "cached-image", parts: [{ type: "text", text: "[image]" }] }]);
  });

it("does not reinterpret non-image parts as media references", () => {
    const normalized = normalizeMessages([{ role: "user", content: [{ ...imageReference, type: "text", text: "not an image" }] }]);
    expect(normalized).toEqual([textMessage("user", "not an image")]);
  });

it("retains references through partial seeding, deltas and final-message reconciliation", () => {
    const partial = { role: "assistant", content: [imageReference, { type: "text", text: "first" }] };
    let live = seedStreamingPartial([], partial);
    live = applyTranscriptEvent(live, { type: "assistant.delta", text: " second" }) ?? live;
    expect(live).toEqual(normalizeMessages([{ ...partial, content: [imageReference, { type: "text", text: "first second" }] }]));
    const final = { ...partial, entryId: "final-image", content: [imageReference, { type: "text", text: "final" }] };
    live = applyTranscriptEvent(live, { type: "message.end", message: final }) ?? live;
    expect(live).toEqual(normalizeMessages([final]));
    expect(applyTranscriptEvent(live, { type: "message.end", message: final })).toEqual(live);
  });

it("replaces optimistic inline images with authoritative references without loss", () => {
    const optimistic = normalizeMessages([{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "QUJD" }] }]);
    const final = { role: "user", entryId: "saved-image", content: [imageReference] };
    expect(applyTranscriptEvent(optimistic, { type: "message.end", message: final })).toEqual(normalizeMessages([final]));
    expect(applyTranscriptEvent([], { type: "message.append", message: final })).toEqual(normalizeMessages([final]));
  });

it("keeps tool reference images identical across history, tool.end and repeated final reconciliation", () => {
    const content = [{ type: "text", text: "image read" }, imageReference];
    const call = { role: "assistant", content: [{ type: "toolCall", id: "read-image", name: "read", arguments: { path: "image.png" } }] };
    const final = { role: "toolResult", toolCallId: "read-image", toolName: "read", content, isError: false };
    let live = applyTranscriptEvent([], { type: "tool.start", toolCallId: "read-image", toolName: "read", summary: "image.png", args: { path: "image.png" } }) ?? [];
    live = applyTranscriptEvent(live, { type: "tool.end", toolCallId: "read-image", toolName: "read", text: "image read", content, details: undefined, isError: false }) ?? live;
    const images = (lines: ChatLine[]) => lines.flatMap((line) => line.parts.filter((part) => part.type === "image"));
    expect(images(live)).toEqual(images(normalizeMessages([call, final])));
    expect(images(live)).toEqual([imageReference]);
    const finalized = applyTranscriptEvent(live, { type: "message.end", message: final }) ?? live;
    expect(images(finalized)).toEqual([imageReference]);
    expect(applyTranscriptEvent(finalized, { type: "message.end", message: final })).toEqual(finalized);
  });

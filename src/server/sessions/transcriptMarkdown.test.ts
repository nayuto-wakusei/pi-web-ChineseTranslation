import { describe, expect, it, vi } from "vitest";
import { projectTranscriptMarkdown } from "./transcriptMarkdown.js";
import type { MarkdownTransformer } from "../../piSdk.js";

describe("transcript Markdown projection", () => {
  it("chains transformations without mutating original text, thinking, or non-text blocks", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "<think></think>answer" },
        { type: "thinking", thinking: "reason", thinkingSignature: "signature" },
        { type: "toolCall", name: "bash", arguments: { command: "ls" } },
      ],
    };
    const original = structuredClone(message);
    const transformer = vi.fn((text: string) => text.replace("<think></think>", ""));
    const onError = vi.fn();
    expect(projectTranscriptMarkdown(message, [transformer, (text) => `${text}!`], onError)).toEqual({
      ...message,
      content: [
        { ...message.content[0], displayText: "answer!" },
        { ...message.content[1], displayText: "reason!" },
        message.content[2],
      ],
    });
    expect(message).toEqual(original);
    expect(transformer.mock.calls).toEqual([
      ["<think></think>answer", { messageType: "assistant", isStreaming: false, availableWidth: 80 }],
      ["reason", { messageType: "assistant-thinking", isStreaming: false, availableWidth: 80 }],
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("supports string user content and preserves an intentionally empty display", () => {
    const transformer = vi.fn(() => "");
    expect(projectTranscriptMarkdown({ role: "user", content: "hide" }, [transformer], vi.fn())).toEqual({ role: "user", content: "hide", displayText: "" });
    expect(transformer).toHaveBeenCalledWith("hide", { messageType: "user", isStreaming: false, availableWidth: 80 });
  });

  it("reports failures and continues the chain from the last successful value", () => {
    const error = new Error("broken extension");
    const onError = vi.fn();
    const result = projectTranscriptMarkdown({ role: "assistant", content: "source" }, [
      (text) => `${text} first`,
      () => { throw error; },
      (text) => `${text} last`,
    ], onError);
    expect(result).toEqual({ role: "assistant", content: "source", displayText: "source first last" });
    expect(onError).toHaveBeenCalledWith(error, 1);
  });

  it("leaves other roles and unchanged content alone", () => {
    const transformer = vi.fn((text: string) => text);
    const assistant = { role: "assistant", content: [{ type: "text", text: "same" }] };
    expect(projectTranscriptMarkdown(assistant, [transformer], vi.fn())).toBe(assistant);
    transformer.mockClear();
    for (const role of ["toolResult", "custom", "system"]) {
      const message = { role, content: "source" };
      expect(projectTranscriptMarkdown(message, [transformer], vi.fn())).toBe(message);
    }
    expect(transformer).not.toHaveBeenCalled();
  });

  it("treats a non-string extension result as a failure without losing the last good value", () => {
    const invalid = vi.fn<MarkdownTransformer>();
    const onError = vi.fn();
    const result = projectTranscriptMarkdown({ role: "user", content: "source" }, [
      (text) => `${text} first`, invalid, (text) => `${text} last`,
    ], onError);
    expect(result).toEqual({ role: "user", content: "source", displayText: "source first last" });
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(TypeError), 1);
  });
});

import type { Api, AssistantMessage, Model } from "../../piAi.js";
import { createAssistantMessageEventStream } from "../../piAi.js";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { expect, it, vi } from "vitest";
import { generateShortSessionName } from "./sessionNameGenerator.js";
import { KNOWN_THINKING_LEVELS } from "../../shared/thinkingLevels.js";

function fakeModel(): Model<Api> {
  return { id: "fake-model", name: "Fake Model", api: "anthropic-messages", provider: "anthropic", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 };
}

function fakeAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "fake-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

function streamThatCompletes(text: string): StreamFn {
  return () => {
    const stream = createAssistantMessageEventStream();
    const message = fakeAssistantMessage({ content: [{ type: "text", text }] });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
}

it("preserves request-language naming when custom options are supplied", async () => {
  const request = "\u4fee\u590d\u767b\u5f55\u95ee\u9898";
  const streamFn: StreamFn = (model, context, options) => {
    expect(JSON.stringify(context.messages[0])).toContain("Use the same language as the user's request");
    expect(context.messages.at(-1)).toMatchObject({ role: "user", content: `Create a 2-6 word title for this request:\n\n${request}` });
    return streamThatCompletes(request)(model, context, options);
  };
  expect(await generateShortSessionName(streamFn, fakeModel(), request, { maxTokens: 1000, thinkingLevel: "off", timeoutMs: 30_000 })).toBe(request);
});
  it.each([false, true])("keeps the default budget at 24 tokens (reasoning: %s)", async (reasoning) => {
    const streamFn: StreamFn = (model, context, options) => {
      expect(options?.maxTokens).toBe(24);
      expect(options?.reasoning).toBe("minimal");
      return streamThatCompletes("A short title")(model, context, options);
    };
    await generateShortSessionName(streamFn, { ...fakeModel(), reasoning }, "A request");
  });

  it("passes an explicit token budget to the model", async () => {
    const streamFn: StreamFn = (model, context, options) => {
      expect(options?.maxTokens).toBe(2048);
      return streamThatCompletes("A short title")(model, context, options);
    };
    await generateShortSessionName(streamFn, fakeModel(), "A request", { maxTokens: 2048 });
  });

  it.each(KNOWN_THINKING_LEVELS)("passes naming thinking level %s independently of the token budget", async (level) => {
    const streamFn: StreamFn = (model, context, options) => {
      expect(options?.reasoning).toBe(level === "off" ? undefined : level);
      expect(options?.maxTokens).toBe(24);
      return streamThatCompletes("A short title")(model, context, options);
    };
    expect(await generateShortSessionName(streamFn, fakeModel(), "A request", { thinkingLevel: level })).toBe("A short title");
  });

  it.each([undefined, 90_000])("uses the total request timeout %s, defaulting to 10 seconds", async (timeoutMs) => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const streamFn: StreamFn = (model, context, options) => {
      expect(options?.signal).toBe(controller.signal);
      return streamThatCompletes("A short title")(model, context, options);
    };
    try {
      await generateShortSessionName(streamFn, fakeModel(), "A request", timeoutMs === undefined ? {} : { timeoutMs });
      expect(timeout).toHaveBeenCalledWith(timeoutMs ?? 10_000);
    } finally {
      timeout.mockRestore();
    }
  });

import type { Api, AssistantMessage, Model, TranscriptContext } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { cleanSessionName, deterministicSessionName, fallbackSessionName, generateShortSessionName } from "./sessionNameGenerator.js";

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

function streamThatErrors(): StreamFn {
  return () => {
    const stream = createAssistantMessageEventStream();
    const message = fakeAssistantMessage({ stopReason: "error", errorMessage: "boom" });
    stream.push({ type: "error", reason: "error", error: message });
    stream.end(message);
    return stream;
  };
}

describe("sessionNameGenerator", () => {
  it("generates a session name by calling the injected streamFn", async () => {
    const contexts: TranscriptContext[] = [];
    const stream = streamThatCompletes('Title: "Fix the bug"');
    const streamFn: StreamFn = (model, context, options) => {
      contexts.push(context);
      return stream(model, context, options);
    };

    const name = await generateShortSessionName(streamFn, fakeModel(), "Please fix the login bug");

    expect(name).toBe("Fix the bug");
    expect(contexts).toHaveLength(1);
    const context = contexts[0];
    if (context === undefined) throw new Error("expected a stream context");
    expect("systemPrompt" in context).toBe(false);
    expect(context.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(JSON.stringify(context.messages[0])).toContain("Generate a concise title");
    expect(JSON.stringify(context.messages[1])).toContain("Please fix the login bug");
  });

  it("returns undefined when the stream reports an error", async () => {
    const streamFn = streamThatErrors();

    const name = await generateShortSessionName(streamFn, fakeModel(), "Please fix the login bug");

    expect(name).toBeUndefined();
  });

  it("cleans model-generated titles", () => {
    expect(cleanSessionName('Title: "Fix Session Naming."\nextra')).toBe("Fix Session Naming");
  });

  it("builds deterministic names for relay handoff prompts", () => {
    expect(deterministicSessionName('Relay "handoff-check" leg 2 begins now.\n\nYou are the next runner.'))
      .toBe("Relay handoff-check leg 2");
  });

  it("preserves the relay leg when truncating deterministic relay names", () => {
    expect(deterministicSessionName('Relay "very-long-relay-name-that-would-otherwise-push-the-leg-number-out-of-view" leg 42 begins now.'))
      .toBe("Relay very-long-relay-name-that-would-otherwise-push leg 42");
  });

  it("does not build deterministic names for non-canonical relay prompts", () => {
    expect(deterministicSessionName('You are continuing Relay "handoff-check" under the Relay method.'))
      .toBeUndefined();
  });

  it("builds a concise fallback from the first request", () => {
    expect(fallbackSessionName("Seems like auto name for sessions is not working, I still get the first message as a name."))
      .toBe("Seems like auto name for sessions");
  });

  it("ignores skill blocks in fallback names", () => {
    expect(fallbackSessionName('<skill name="x" location="/x">\nDo x\n</skill>\n\nCheck the UI now'))
      .toBe("Check the UI now");
  });

  it("skips fallback names when the first request is missing", () => {
    expect(fallbackSessionName(undefined)).toBeUndefined();
  });
});

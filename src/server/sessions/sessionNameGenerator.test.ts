import type { Api, AssistantMessage, Model, TranscriptContext } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "../../piAi.js";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { cleanSessionName, fallbackSessionName, generateShortSessionName, requireInitialSessionName } from "./sessionNameGenerator.js";

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

  it("preserves explicit extension names", () => {
    expect(requireInitialSessionName("A workflow leg 2")).toBe("A workflow leg 2");
  });

  it.each([undefined, null, "", " ", " padded", "padded ", "two\nlines", "control\0character", "a".repeat(61)])("rejects invalid initial names (%j)", (value) => {
    expect(() => requireInitialSessionName(value)).toThrow("Initial session name");
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

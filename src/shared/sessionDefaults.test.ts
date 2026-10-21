import { describe, expect, it } from "vitest";
import { parseSessionDefaults, parseSessionDefaultsUpdate } from "./sessionDefaults.js";

describe("session default pins", () => {
  it("accepts exactly one selector", () => {
    expect(parseSessionDefaultsUpdate({ provider: "anthropic", modelId: "claude-opus" })).toEqual({
      provider: "anthropic",
      modelId: "claude-opus",
    });
    expect(parseSessionDefaultsUpdate({ thinkingLevel: "high" })).toEqual({ thinkingLevel: "high" });
  });

  it("rejects a mixed or incomplete pin", () => {
    expect(() => parseSessionDefaultsUpdate({ provider: "anthropic", modelId: "claude-opus", thinkingLevel: "low" })).toThrow("Specify either provider/modelId or thinkingLevel");
    expect(() => parseSessionDefaultsUpdate({ provider: "anthropic" })).toThrow(/provider and modelId/);
    expect(() => parseSessionDefaultsUpdate({ thinkingLevel: "extra" })).toThrow(/Invalid thinking level/);
  });

  it("reads only pin fields from scoped global settings", () => {
    expect(parseSessionDefaults({
      defaultProvider: "openai",
      defaultModel: "gpt",
      defaultThinkingLevel: "medium",
      packages: ["./ignored"],
    })).toEqual({
      defaultProvider: "openai",
      defaultModel: "gpt",
      defaultThinkingLevel: "medium",
    });
    expect(() => parseSessionDefaults({ defaultThinkingLevel: 1 })).toThrow(/defaultThinkingLevel/);
  });
});

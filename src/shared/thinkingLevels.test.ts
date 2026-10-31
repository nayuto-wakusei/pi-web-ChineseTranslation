import { describe, expect, it } from "vitest";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { KNOWN_THINKING_LEVELS, isKnownThinkingLevel, thinkingGauge, thinkingLevelDescription, thinkingLevelDisplayLabel, thinkingLevelLabel } from "./thinkingLevels";
import messages from "../../pi-web-plugins/zh-cn/client.json";
import { createTranslator } from "./i18n";

// Compile-time drift guard: if pi ADDS a thinking level we do not know about,
// `Extra` becomes that level and this assignment fails to type-check. Combined
// with the `satisfies readonly ThinkingLevel[]` clause in thinkingLevels.ts
// (which catches removals/renames), this pins KNOWN_THINKING_LEVELS to pi's
// union exactly. When this breaks, update KNOWN_THINKING_LEVELS and give the new
// level a label/description where thinking levels are presented.
type Extra = Exclude<ThinkingLevel, (typeof KNOWN_THINKING_LEVELS)[number]>;
const _noUnknownLevels: Extra extends never ? true : never = true;
void _noUnknownLevels;

describe("thinkingLevels", () => {
  it("recognizes all known levels and rejects others", () => {
    for (const level of KNOWN_THINKING_LEVELS) expect(isKnownThinkingLevel(level)).toBe(true);
    expect(isKnownThinkingLevel("ultra")).toBe(false);
    expect(isKnownThinkingLevel("")).toBe(false);
  });

  it("labels levels, defaulting empty/undefined to off", () => {
    expect(thinkingLevelLabel(undefined)).toBe("off");
    expect(thinkingLevelLabel("")).toBe("off");
    expect(thinkingLevelLabel("high")).toBe("high");
    expect(thinkingLevelLabel("brand-new-level")).toBe("brand-new-level");
  });

  it("defaults display labels to English without changing unknown runtime values", () => {
    expect(thinkingLevelDisplayLabel(undefined)).toBe("Off");
    expect(thinkingLevelDisplayLabel("medium")).toBe("Medium");
    expect(thinkingLevelDisplayLabel("xhigh")).toBe("Extra high");
    expect(thinkingLevelDisplayLabel("brand-new-level")).toBe("brand-new-level");
  });

  it("describes each supported thinking level", () => {
    expect(thinkingLevelDescription("off")).toBe("No reasoning");
    expect(thinkingLevelDescription("xhigh")).toBe("Extra high reasoning (about 32k tokens)");
    expect(thinkingLevelDescription("max")).toBe("Maximum reasoning (about 64k tokens)");
    expect(thinkingLevelDescription("brand-new-level")).toBeUndefined();
  });

  it("localizes labels and descriptions only, never level identifiers or unknown values", () => {
    const chinese = createTranslator("zh-CN", messages);
    const english = createTranslator("en", messages);
    for (const level of KNOWN_THINKING_LEVELS) {
      expect(thinkingLevelDisplayLabel(level, chinese)).toMatch(/\p{Script=Han}/u);
      expect(thinkingLevelDescription(level, chinese)).toMatch(/\p{Script=Han}/u);
      expect(thinkingLevelDisplayLabel(level, english)).not.toMatch(/\p{Script=Han}/u);
      expect(thinkingLevelDescription(level, english)).not.toMatch(/\p{Script=Han}/u);
      expect(thinkingLevelLabel(level)).toBe(level);
    }
    expect(thinkingLevelDisplayLabel("用户自定义级别", chinese)).toBe("用户自定义级别");
    expect(thinkingLevelDisplayLabel("用户自定义级别", english)).toBe("用户自定义级别");
    expect(thinkingLevelDescription("用户自定义级别", chinese)).toBeUndefined();
  });

  describe("thinkingGauge", () => {
    const known = KNOWN_THINKING_LEVELS;

    it("adapts to a runtime-provided set of a different size", () => {
      const available = ["off", "low", "high"];
      expect(thinkingGauge("off", available)).toEqual({ total: 2, filled: 0 });
      expect(thinkingGauge(undefined, available)).toEqual({ total: 2, filled: 0 });
      expect(thinkingGauge("low", available)).toEqual({ total: 2, filled: 1 });
      expect(thinkingGauge("high", available)).toEqual({ total: 2, filled: 2 });
    });

    it("falls back to the known set when no usable available set is given", () => {
      expect(thinkingGauge("high", [])).toEqual(thinkingGauge("high", known));
      expect(thinkingGauge("high", ["only-one"])).toEqual(thinkingGauge("high", known));
    });

    it("fills 0 for an unknown current level instead of throwing", () => {
      expect(thinkingGauge("brand-new-level", known).filled).toBe(0);
    });
  });
});

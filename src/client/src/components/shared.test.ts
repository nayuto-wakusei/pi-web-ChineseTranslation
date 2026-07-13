import { describe, expect, it } from "vitest";
import { chatStyles } from "./styles/chatStyles";

describe("chatStyles", () => {
  it("bounds the chat scroller to its flex-allocated wrapper", () => {
    const chatRule = /\.chat\s*\{([^}]*)\}/.exec(chatStyles.cssText)?.[1];

    expect(chatStyles.cssText).toContain(".chat-wrap { position: relative;");
    expect(chatRule).toContain("position: absolute");
    expect(chatRule).toContain("inset: 0");
    expect(chatRule).not.toContain("height: 100%");
  });

  it("constrains uploaded chat images inside their figure wrapper", () => {
    expect(chatStyles.cssText).toContain(".chat-image img");
    expect(chatStyles.cssText).toContain("max-width: min(100%, 420px)");
    expect(chatStyles.cssText).toContain("max-height: 320px");
  });
});

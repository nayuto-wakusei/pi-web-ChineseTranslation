import { describe, expect, it } from "vitest";
import { chatStyles } from "./shared";

describe("chatStyles", () => {
  it("bounds the chat scroller to its flex-allocated wrapper", () => {
    const chatRule = /\.chat\s*\{([^}]*)\}/.exec(chatStyles.cssText)?.[1];

    expect(chatStyles.cssText).toContain(".chat-wrap { position: relative;");
    expect(chatRule).toContain("position: absolute");
    expect(chatRule).toContain("inset: 0");
    expect(chatRule).not.toContain("height: 100%");
  });

  it("keeps assistant text at the full available width while it streams", () => {
    const messageRule = /\.msg\s*\{([^}]*)\}/.exec(chatStyles.cssText)?.[1];
    const formattedTextRule = /formatted-text\.part\s*\{([^}]*)\}/.exec(chatStyles.cssText)?.[1];

    expect(messageRule).toContain("width: 100%");
    expect(formattedTextRule).toContain("display: block");
    expect(formattedTextRule).toContain("width: 100%");
  });

  it("constrains uploaded chat images inside their figure wrapper", () => {
    expect(chatStyles.cssText).toContain(".chat-image { display: block");
    expect(chatStyles.cssText).toContain("max-width: 100%");
    expect(chatStyles.cssText).toContain("max-height: 320px");
  });
});

import { describe, expect, it } from "vitest";
import { chatStyles } from "./styles/chatStyles";

describe("chatStyles", () => {
  it("constrains uploaded chat images inside their figure wrapper", () => {
    expect(chatStyles.cssText).toContain(".chat-image img");
    expect(chatStyles.cssText).toContain("max-width: min(100%, 420px)");
    expect(chatStyles.cssText).toContain("max-height: 320px");
  });
});

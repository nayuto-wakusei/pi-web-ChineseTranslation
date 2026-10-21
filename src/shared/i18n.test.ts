import { describe, expect, it } from "vitest";
import { createTranslator, parseTranslationMessages, UserFacingError, userFacingErrorMessage } from "./i18n";

describe("translation catalogs", () => {
  it("localizes only tagged owned errors and preserves internal matching and remote error text", () => {
    const translate = createTranslator("zh-CN", { missing: "未找到 {id}" });
    const owned = new UserFacingError("missing", "Not found: {id}", { id: "session-1" });
    expect(owned.message).toBe("Not found: session-1");
    expect(userFacingErrorMessage(owned, translate)).toBe("未找到 session-1");
    expect(userFacingErrorMessage(new Error(owned.message), translate)).toBe("Not found: session-1");
    expect(userFacingErrorMessage("upstream message", translate)).toBe("upstream message");
  });

  it("uses English when disabled or missing and formats named values once", () => {
    const messages = { "session.count": "会话：{count}", "session.name": "名称：{name}" };
    expect(createTranslator("en", messages)("session.count", "Sessions: {count}", { count: 2 })).toBe("Sessions: 2");
    expect(createTranslator("zh-CN", messages)("missing", "Missing {count}", { count: 1 })).toBe("Missing 1");
    expect(createTranslator("zh-CN", messages)("session.count", "Sessions: {count}", { count: 2 })).toBe("会话：2");
    expect(createTranslator("zh-CN", messages)("session.name", "Name: {name}", { name: "<b>{count}</b>" })).toBe("名称：<b>{count}</b>");
  });

  it("does not use a catalog entry with incompatible parameters or inherited properties", () => {
    const translate = createTranslator("zh-CN", { key: "{wrong}" });
    expect(translate("key", "{name}", { name: "file.txt" })).toBe("file.txt");
    expect(translate("toString", "Default")).toBe("Default");
  });

  it("rejects malformed catalog data", () => {
    expect(parseTranslationMessages({ hello: "你好" })).toEqual({ hello: "你好" });
    for (const value of [null, [], "text", { key: 1 }, { "": "empty key" }]) {
      expect(() => parseTranslationMessages(value)).toThrow("Invalid translation catalog");
    }
  });
});

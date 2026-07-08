import { describe, expect, it } from "vitest";
import { normalAuthPasswordFormError } from "./NormalAuthDialog";

describe("normal auth dialog validation", () => {
  it("requires password confirmation when setting the first password", () => {
    expect(normalAuthPasswordFormError("setup", { password: "", confirmPassword: "" })).toBe("请输入密码。");
    expect(normalAuthPasswordFormError("setup", { password: "secret", confirmPassword: "different" })).toBe("两次输入的密码不一致。");
    expect(normalAuthPasswordFormError("setup", { password: "secret", confirmPassword: "secret" })).toBeUndefined();
  });

  it("requires current password when changing the ordinary mode password", () => {
    expect(normalAuthPasswordFormError("change", { currentPassword: "", password: "new-pass", confirmPassword: "new-pass" })).toBe("请输入当前密码。");
    expect(normalAuthPasswordFormError("change", { currentPassword: "old-pass", password: "new-pass", confirmPassword: "new-pass" })).toBeUndefined();
  });
});

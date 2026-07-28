import { describe, expect, it } from "vitest";
import { NormalAuthDialog, normalAuthDialogTitle, normalAuthPasswordFormError } from "./NormalAuthDialog";

describe("normal auth dialog title", () => {
  it("uses the concise login prompt", () => {
    expect(normalAuthDialogTitle("setup")).toBe("设置进入密码");
    expect(normalAuthDialogTitle("change")).toBe("修改进入密码");
    expect(normalAuthDialogTitle("login")).toBe("输入密码");
  });
});

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

describe("normal auth dialog styles", () => {
  it("keeps the primary action text white on accent backgrounds", () => {
    expect(normalAuthDialogStyles()).toContain(".primary { border-color: var(--pi-accent); background: var(--pi-accent); color: #fff;");
  });
});

function normalAuthDialogStyles(): string {
  return NormalAuthDialog.styles.cssText;
}

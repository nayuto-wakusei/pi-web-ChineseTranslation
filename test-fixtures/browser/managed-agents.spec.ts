import { expect, test } from "@playwright/test";

for (const width of [1280, 360]) {
  test(`reviews instructions without dismissing an undecided notification at ${String(width)}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/managed-agents.html");
    const trigger = page.locator(".agents-trigger");
    await expect(trigger).toHaveClass(/pending/);
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "AGENTS.md" });
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("平台模板更新时间");
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds === null) throw new Error("Menu did not render");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(760);
    await page.screenshot({ path: testInfo.outputPath("agents-review.png") });
    await menu.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(menu).not.toBeVisible();
    await expect(trigger).toHaveClass(/pending/);
    await expect(page.locator("body")).not.toHaveAttribute("data-decision");
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveClass(/pending/);
    await trigger.click();
    await menu.getByRole("button", { name: "不覆盖", exact: true }).click();
    await expect(trigger).not.toHaveClass(/pending/);
    await expect(page.locator("body")).toHaveAttribute("data-decision", "keep");
    await trigger.click();
    await menu.getByRole("button", { name: "覆盖并备份", exact: true }).click();
    await expect(page.locator("body")).toHaveAttribute("data-decision", "overwrite");
  });
}

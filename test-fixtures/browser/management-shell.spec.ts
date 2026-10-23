import { expect, test } from "@playwright/test";

test("management shell retains navigation when an embedded viewport expands", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/management-shell.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#navigation-panel app-navigation-panel")).toBeVisible();
  await expect(page.locator('app-panel-edge-control[side="navigation"]')).toBeVisible();
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(page.locator("#navigation-panel")).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator("#navigation-panel app-navigation-panel")).toBeVisible();
  await expect(page.locator('app-panel-edge-control[side="navigation"]')).toBeVisible();
});

test("saved navigation collapse survives viewport changes and remains recoverable", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pi-web:panel-collapse:v1", JSON.stringify({
      version: 1,
      navigationPanelCollapsed: true,
      workspacePanelCollapsed: false,
    }));
  });
  await page.setViewportSize({ width: 969, height: 812 });
  await page.goto("/management-shell.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const panel = page.locator("#navigation-panel");
  const edge = page.locator('app-panel-edge-control[side="navigation"]');
  const toggle = edge.getByRole("button");
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 1397, height: 812 });
  await expect(page.locator(".shell")).not.toHaveClass(/two-column-layout/);
  await expect(panel).toBeHidden();
  await expect(toggle).toBeInViewport();
  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => page.evaluate(() => {
    const preference: unknown = JSON.parse(localStorage.getItem("pi-web:panel-collapse:v1") ?? "{}");
    return typeof preference === "object" && preference !== null && "navigationPanelCollapsed" in preference
      ? preference.navigationPanelCollapsed : undefined;
  })).toBe(false);
});

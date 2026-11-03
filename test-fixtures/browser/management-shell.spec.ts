import { expect, test } from "@playwright/test";

for (const mode of ["normal", "management"]) {
  test(`${mode} shell pin menus share revisioned navigation membership and ordering`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let ids: string[] = [];
    let revision = 0;
    const writes: string[][] = [];
    await page.route("**/api/machines/local/navigation/projects/p/workspaces/w/session-pins*", async (route) => {
      expect(new URL(route.request().url()).searchParams.get("embed")).toBe(mode === "management" ? "management" : null);
      if (route.request().method() === "PUT") {
        const value: unknown = route.request().postDataJSON();
        if (typeof value !== "object" || value === null || !("ids" in value) || !Array.isArray(value.ids)
          || !value.ids.every((id): id is string => typeof id === "string") || !("revision" in value)) {
          throw new Error("Invalid pin preference request");
        }
        expect(value.revision).toBe(revision);
        ids = value.ids;
        revision++;
        writes.push([...ids]);
      }
      await route.fulfill({ json: { ids, revision } });
    });
    await page.goto(`/management-shell.html?pins&mode=${mode}`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const list = page.locator("session-list");
    const row = (id: string) => list.locator(`.action-row[data-session-id="${id}"]`);
    for (const id of ["one", "two"]) {
      await row(id).locator(".action-menu-toggle").click();
      await list.getByTitle("Pin session", { exact: true }).click();
      await expect(row(id)).toHaveClass(/pinned/);
    }
    await row("two").locator(".action-menu-toggle").click();
    await list.getByRole("button", { name: "Move up", exact: true }).click();
    await expect.poll(() => writes).toEqual([["one"], ["one", "two"], ["two", "one"]]);
    await list.getByTitle("Unpin session", { exact: true }).click();
    await expect(row("two")).not.toHaveClass(/pinned/);
    await expect.poll(() => ids).toEqual(["one"]);
  });
}

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
  const toggle = page.locator('button[data-panel-toggle="navigation"]:visible');
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Expand navigation panel", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1397, height: 812 });
  await expect(page.locator(".shell")).not.toHaveClass(/two-column-layout/);
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
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

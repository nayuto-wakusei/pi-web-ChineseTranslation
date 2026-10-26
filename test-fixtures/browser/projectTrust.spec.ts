import { expect, test } from "@playwright/test";

test("folder project trust is reachable without a workspace section", async ({ page }, testInfo) => {
  let trusted = false;
  const writes: unknown[] = [];
  await page.route("**/api/machines/local/projects/folder/workspaces", async (route) => {
    await route.fulfill({ json: {
      status: "folder", projectId: "folder", diagnostics: [],
      workspaces: [{ id: "plain", projectId: "folder", path: "/fixture/plain", label: "普通文件夹项目", isMain: true, effectiveConfig: {} }],
    } });
  });
  await page.route("**/api/machines/local/projects/folder/workspaces/plain/trust", async (route) => {
    if (route.request().method() === "PUT") {
      const body: unknown = route.request().postDataJSON();
      writes.push(body);
      trusted = !trusted;
    }
    await route.fulfill({ json: { path: "/fixture/plain", decision: trusted, trusted } });
  });
  await page.goto("/navigation.html?folder-trust");
  const projects = page.locator("project-list");
  await projects.locator(".action-menu-toggle").click();
  const checkbox = projects.getByRole("checkbox", { name: "已信任", exact: true });
  await expect(checkbox).toBeEnabled();
  await expect(page.locator("workspace-list")).toHaveCount(0);
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).toBeChecked();
  expect(writes).toEqual([{ trusted: true }]);
  const panel = projects.locator(".action-menu-panel");
  const bounds = await panel.boundingBox();
  const viewport = page.viewportSize();
  if (bounds === null || viewport === null) throw new Error("Missing menu or viewport bounds");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
  await page.screenshot({ path: testInfo.outputPath("folder-project-trust.png") });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(projects.locator(".action-menu-toggle")).toBeFocused();
});

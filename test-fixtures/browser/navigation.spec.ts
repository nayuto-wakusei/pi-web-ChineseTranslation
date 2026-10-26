import { expect, test } from "@playwright/test";

test("Chinese navigation controls load shared styles and the palette stays compact", async ({ page }, testInfo) => {
  await page.goto("/navigation.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const actions = page.locator("app-navigation-panel .header-actions button");
  await expect(actions).toHaveText("操作");
  for (const tag of ["project-list", "workspace-list"]) {
    const toggle = page.locator(`${tag} .section-toggle`).first();
    expect(await toggle.evaluate((element) => element.getBoundingClientRect().height)).toBe(32);
  }
  const emptyState = page.locator("project-list .empty-list");
  await expect(emptyState).toBeVisible();
  const controls = page.locator("app-navigation-panel .panel-toggle, app-navigation-panel .header-actions button, session-list .cleanup-entry, session-list .start-session-button, session-list .session-search");
  for (const control of await controls.all()) {
    await expect(control).toBeVisible();
    expect(await control.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");
    expect(await control.evaluate((element) => getComputedStyle(element).display)).toBe("flex");
  }
  const heading = await page.locator("session-list .section-toggle").first().boundingBox();
  const tools = await page.locator("session-list .session-heading-actions").boundingBox();
  expect(heading).not.toBeNull();
  expect(tools).not.toBeNull();
  expect(tools?.x).toBeGreaterThanOrEqual(heading?.x ?? 0);
  if (testInfo.project.name !== "touch") {
    const tab = page.locator("workspace-panel .tabs button");
    await expect(tab).toBeVisible();
    expect(await tab.evaluate((element) => getComputedStyle(element).minHeight)).toBe("44px");
    expect(await tab.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");
  }
  await page.screenshot({ path: testInfo.outputPath("navigation.png"), fullPage: true });
  await actions.click();
  const palette = page.locator("action-palette");
  await expect(palette.getByRole("textbox")).toBeFocused();
  const first = palette.locator(".ui-selection-option").first();
  await expect(first).toContainText("显示操作");
  const description = await first.locator(".description").boundingBox();
  const group = await first.locator(".group").boundingBox();
  expect(description).not.toBeNull();
  expect(group).not.toBeNull();
  expect(Math.abs((description?.y ?? 0) - (group?.y ?? 0))).toBeLessThan(2);
  expect(await palette.evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("palette.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
});

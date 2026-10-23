import { expect, test, type Locator } from "@playwright/test";

async function typePrompt(input: Locator, text: string): Promise<void> {
  // CodeMirror needs native keyboard input; WebKit's contenteditable fill can
  // leave its document unchanged without emitting an input event.
  await input.press("ControlOrMeta+A");
  await input.pressSequentially(text);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/overlays.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
});

test("completions escape layout clipping, preserve editor focus, and disappear on session changes", async ({ page }) => {
  const input = page.locator("prompt-editor .cm-content");
  for (const trigger of ["/", "@", "#"]) {
    await typePrompt(input, trigger);
    const suggestion = page.locator("autocomplete-menu button").first();
    await expect(suggestion).toBeVisible();
    await suggestion.click({ trial: true });
    await expect(input).toBeFocused();
    await input.press("Escape");
    await expect(page.locator("autocomplete-menu [popover]:popover-open")).toHaveCount(0);
  }
  await typePrompt(input, "/");
  const pick = page.locator("autocomplete-menu button");
  await expect(pick).toBeVisible();
  if (test.info().project.name === "touch") await pick.tap();
  else await pick.click();
  await expect(input).toHaveText("/tree");
  await expect(input).toBeFocused();
  await typePrompt(input, "/");
  await expect(page.locator("autocomplete-menu button")).toBeVisible();
  await page.getByRole("button", { name: "Switch session", exact: true }).click();
  await expect(page.locator("autocomplete-menu [popover]:popover-open")).toHaveCount(0);
});


test("nested anchored menus escape transformed clipping and Escape closes only the child", async ({ page }) => {
  const switcher = page.locator(".clip machine-switcher");
  const trigger = switcher.getByRole("button", { name: /Switch machine/ });
  await trigger.click();
  const panel = switcher.locator(".machine-switcher-menu");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: /Remote/ }).first().click({ trial: true });
  const actions = panel.getByRole("button", { name: /actions.*Remote|Remote.*actions/i });
  await actions.click();
  const child = switcher.locator(".machine-option-actions-panel");
  await expect(child).toBeVisible();
  await child.getByRole("button", { name: "Remove" }).click({ trial: true });
  await page.keyboard.press("Escape");
  await expect(child).not.toBeVisible();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
});

test("popups follow shadow-root scrolling and stay within a resized viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  const switcher = page.locator(".clip machine-switcher");
  const trigger = switcher.getByRole("button", { name: /Switch machine/ });
  await trigger.click();
  const panel = switcher.locator(".machine-switcher-menu");
  await expect(panel).toBeVisible();
  const before = await panel.boundingBox();
  if (before === null) throw new Error("Missing popup geometry");
  await page.locator(".scroll").evaluate((element) => { element.scrollTop = 10; });
  await expect.poll(async () => (await panel.boundingBox())?.y).toBeCloseTo(before.y - 10, 0);
  await page.setViewportSize({ width: 390, height: 600 });
  await expect.poll(async () => {
    const box = await panel.boundingBox();
    return box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 600;
  }).toBe(true);
});


test("modal ownership dismisses background suggestions, allows owned menus, and restores focus", async ({ page }, testInfo) => {
  const input = page.locator("prompt-editor .cm-content");
  await typePrompt(input, "/");
  await expect(page.locator("autocomplete-menu button")).toBeVisible();
  const opener = page.getByRole("button", { name: "Open dialog", exact: true });
  // Safari does not retain button focus on pointer clicks. Keyboard activation
  // establishes the same focus-restoration precondition in every browser.
  await opener.focus();
  await opener.press("Enter");
  const dialog = page.locator("modal-surface").filter({ has: page.getByRole("dialog", { name: "Dialog 1", exact: true }) });
  await expect(page.getByRole("dialog", { name: "Dialog 1", exact: true })).toHaveCount(1);
  await expect(dialog.locator("dialog")).toBeVisible();
  await expect(page.locator("autocomplete-menu [popover]:popover-open")).toHaveCount(0);
  await page.evaluate(() => window.overlayFixture.complete());
  await expect(page.locator("autocomplete-menu [popover]:popover-open")).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Dialog input" })).toBeFocused();
  await dialog.getByRole("button", { name: /Switch machine/ }).click();
  const menu = dialog.locator(".machine-switcher-menu");
  await expect(menu).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("owned-menu.png"), fullPage: true });
  await menu.getByRole("button", { name: /Remote/ }).first().click({ trial: true });
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(dialog.locator("dialog")).toBeVisible();
  const nestedOpener = dialog.getByRole("button", { name: "Open nested dialog" });
  await nestedOpener.focus();
  await nestedOpener.press("Enter");
  const nested = page.locator("modal-surface").filter({ has: page.getByRole("dialog", { name: "Dialog 2", exact: true }) });
  await expect(nested.getByRole("textbox", { name: "Dialog input" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(nested).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Open nested dialog" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("unmanaged plugin dialogs share the modality boundary", async ({ page }) => {
  await typePrompt(page.locator("prompt-editor .cm-content"), "/");
  await expect(page.locator("autocomplete-menu button")).toBeVisible();
  await page.evaluate(() => { window.overlayFixture.openPluginModal(); });
  await expect(page.getByRole("textbox", { name: "Plugin input" })).toBeFocused();
  await expect(page.locator("autocomplete-menu [popover]:popover-open")).toHaveCount(0);
  await page.locator("dialog").getByRole("button", { name: /Switch machine/ }).click();
  await expect(page.locator("dialog .machine-switcher-menu")).toBeVisible();
});

test("hiding the conversation closes its suggestions", async ({ page }) => {
  await typePrompt(page.locator("prompt-editor .cm-content"), "/");
  await expect(page.locator("autocomplete-menu button")).toBeVisible();
  await page.evaluate(() => { window.overlayFixture.hideConversation(); });
  await expect(page.locator("autocomplete-menu [popover]:popover-open")).toHaveCount(0);
});

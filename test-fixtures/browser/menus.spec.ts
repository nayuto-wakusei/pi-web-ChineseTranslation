import { expect, test, type Locator } from "@playwright/test";

test("all session menu actions use the upstream menu geometry", async ({ page }, testInfo) => {
  await page.goto("/navigation.html?menu-alignment");
  const sessions = page.locator("session-list");
  await sessions.locator(".action-menu-toggle").click();
  const menu = sessions.locator(".action-menu-panel");
  await expectInsideViewport(menu);
  const actions = menu.getByRole("button");
  expect(await actions.count()).toBeGreaterThanOrEqual(7);
  const geometry = await actions.evaluateAll((buttons) => buttons.map((button) => {
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return {
      styled: button.classList.contains("ui-button") && button.classList.contains("ui-menu-item"),
      height: rect.height, x: rect.x, width: rect.width, border: style.borderTopWidth,
      textAlign: style.textAlign, fontSize: style.fontSize, borderRadius: style.borderRadius,
    };
  }));
  expect(geometry.every((item) => item.styled)).toBe(true);
  expect(new Set(geometry.map((item) => JSON.stringify(item))).size).toBe(1);
  expect(geometry[0]?.border).toBe("0px");
  await menu.getByRole("button", { name: "归档", exact: true }).hover();
  await page.screenshot({ path: testInfo.outputPath("session-menu-upstream.png") });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

async function expectInsideViewport(element: Locator): Promise<void> {
  await expect(element).toBeVisible();
  expect(await element.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth + 1
      && rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
  })).toBe(true);
}

test("nested pickers share row geometry and dismiss only the top menu", async ({ page }, testInfo) => {
  await page.goto("/navigation.html");
  await page.getByRole("button", { name: "Picker fixture", exact: true }).click();
  const command = page.locator("command-picker");
  const option = command.locator(".ui-selection-option");
  const pin = command.locator(".default-pin");
  await expectInsideViewport(option);
  const rowBox = await option.evaluate((node) => { const { height, right } = node.getBoundingClientRect(); return { height, right }; });
  const pinBox = await pin.evaluate((node) => { const { height, left } = node.getBoundingClientRect(); return { height, left }; });
  expect(rowBox.height).toBeGreaterThanOrEqual(44);
  expect(pinBox.left).toBeGreaterThanOrEqual(rowBox.right - 1);
  expect(Math.abs(rowBox.height - pinBox.height)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath("command-menu.png") });
  await option.click();
  const model = page.locator("model-picker");
  await expect(model.locator("input.search")).toBeFocused();
  await expectInsideViewport(model.locator(".default-row"));
  await model.getByRole("button", { name: "全部模型", exact: true }).click();
  await expectInsideViewport(model.locator(".catalog-row").first());
  await expect(model.locator(".catalog-row input").first()).toBeDisabled();
  expect(await model.locator(".membership").first().evaluate((element) => getComputedStyle(element).minHeight)).toBe("44px");
  await page.screenshot({ path: testInfo.outputPath("model-menu.png") });
  await page.keyboard.press("Escape");
  await expect(model).toHaveCount(0);
  await expect(option).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(command).toHaveCount(0);
});

test("navigation and authentication choices use the shared selection surface", async ({ page }, testInfo) => {
  await page.goto("/navigation.html");
  await page.getByRole("button", { name: "Navigation fixture", exact: true }).click();
  const navigation = page.locator("navigation-dialog");
  for (const row of await navigation.locator(".destination").all()) {
    await expectInsideViewport(row);
    expect(await row.evaluate((element) => getComputedStyle(element).display)).toBe("flex");
  }
  await expectInsideViewport(navigation.locator(".toggle-options"));
  await page.screenshot({ path: testInfo.outputPath("navigation-menu.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Auth fixture", exact: true }).click();
  const auth = page.locator("auth-dialog");
  for (const option of await auth.locator(".ui-selection-option").all()) {
    await expectInsideViewport(option);
    expect(await option.evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("16px");
  }
  await page.screenshot({ path: testInfo.outputPath("auth-menu.png") });
});

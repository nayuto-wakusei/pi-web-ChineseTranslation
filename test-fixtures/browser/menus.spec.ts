import { expect, test, type Locator } from "@playwright/test";

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
  const rowBox = await option.boundingBox();
  const pinBox = await pin.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(pinBox).not.toBeNull();
  expect(rowBox?.height).toBeGreaterThanOrEqual(44);
  expect(pinBox?.x).toBeGreaterThanOrEqual((rowBox?.x ?? 0) + (rowBox?.width ?? 0) - 1);
  expect(Math.abs((rowBox?.height ?? 0) - (pinBox?.height ?? 0))).toBeLessThan(1);
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

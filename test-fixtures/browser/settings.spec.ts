import { expect, test } from "@playwright/test";
import type { SettingsDialog } from "../../src/client/src/components/SettingsDialog";

test("settings subpages retain shared spacing and visible controls", async ({ page }, testInfo) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/settings.html");
  const dialog = page.locator("settings-dialog");
  const sections = dialog.locator(".settings-nav");
  for (const [name, tag] of [[/^Pi 包/, "settings-packages-panel"], [/^PI WEB 插件/, "settings-plugins-panel"], [/^键盘/, "settings-shortcuts-panel"]] as const) {
    await sections.getByRole("button", { name }).click();
    const panel = dialog.locator(tag);
    await expect(panel).toBeVisible();
    const content = panel.locator(".ui-settings-section, .ui-settings-summary, .ui-settings-path").first();
    await expect(content).toBeVisible();
    expect(await content.evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft))).toBeGreaterThanOrEqual(12);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    if (tag === "settings-shortcuts-panel") {
      const choices = panel.locator(".prompt-enter-option");
      await expect(choices).toHaveCount(3);
      let bottom = 0;
      for (const choice of await choices.all()) {
        await expect(choice).toBeVisible();
        const box = await choice.evaluate((node) => { const { top, bottom } = node.getBoundingClientRect(); return { top, bottom }; });
        expect(box.top).toBeGreaterThanOrEqual(bottom);
        bottom = box.bottom;
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`${tag}.png`) });
  }
});

test("settings machine selection and dirty confirmation fit the viewport without changing the workspace", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/settings.html");
  const dialog = page.locator("settings-dialog");
  const selector = dialog.getByLabel("配置机器", { exact: true });
  const machineSection = dialog.getByRole("region", { name: "所选机器的文件访问和上传设置", exact: true });
  const upload = machineSection.locator("input").first();
  await expect(upload).toHaveValue("remote-a/uploads");
  await expect(selector).toHaveValue("remote-a");
  await upload.fill("pending/uploads");
  await selector.selectOption("remote-b");
  await expect(selector).toHaveValue("remote-a");
  const confirmation = dialog.getByRole("alert", { name: "机器设置尚未保存", exact: true });
  await expect(confirmation).toContainText("文件访问或上传设置尚未保存");
  await confirmation.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(upload).toHaveValue("pending/uploads");
  await selector.selectOption("remote-b");
  await confirmation.getByRole("button", { name: "放弃修改并切换", exact: true }).click();
  await expect(selector).toHaveValue("remote-b");
  await expect(upload).toHaveValue("remote-b/uploads");
  expect(await dialog.evaluate((element: SettingsDialog) => element.machine?.id)).toBe("remote-a");
  await selector.selectOption("remote-a");
  await upload.fill("pending/uploads");
  await selector.selectOption("remote-b");
  await expect(confirmation).toBeVisible();
  const toolbar = dialog.locator(".settings-machine");
  const content = dialog.locator(".settings-content");
  const boxes = await Promise.all([toolbar.boundingBox(), confirmation.boundingBox(), content.boundingBox()]);
  const [toolbarBox, confirmationBox, contentBox] = boxes;
  if (toolbarBox === null || confirmationBox === null || contentBox === null) throw new Error("Settings layout is missing");
  const headerBox = await dialog.locator(".settings-header").boundingBox();
  if (headerBox === null) throw new Error("Settings header is missing");
  expect(headerBox.height).toBeLessThanOrEqual(64);
  expect(confirmationBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height - 1);
  expect(contentBox.y).toBeGreaterThanOrEqual(confirmationBox.y + confirmationBox.height - 1);
  expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await confirmation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
  await content.evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("settings-machine-confirmation.png") });
});

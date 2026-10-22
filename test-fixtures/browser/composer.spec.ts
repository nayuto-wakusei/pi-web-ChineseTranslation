import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/composer.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
});

test("long transcript and composer keep independent geometry with navigation in the input", async ({ page }, testInfo) => {
  const chat = page.locator("chat-view .chat");
  const editor = page.locator("prompt-editor");
  const navigation = editor.getByRole("navigation", { name: "Chat navigation" });
  await expect(navigation).toBeVisible();
  await expect(page.locator("chat-view .chat-jumps")).toHaveCount(0);
  await navigation.getByRole("button", { name: "Jump to end", exact: true }).click();
  await expect.poll(async () => await chat.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);
  await expect(page.locator('chat-view article[data-index="99"]')).toBeVisible();
  const chatBox = await chat.boundingBox();
  const editorBox = await editor.boundingBox();
  const activity = await page.locator("conversation-layout .activity-region").boundingBox();
  if (chatBox === null || editorBox === null || activity === null) throw new Error("Expected conversation geometry");
  expect(chatBox.y + chatBox.height).toBeLessThanOrEqual(editorBox.y + 1);
  expect(activity.height).toBeLessThanOrEqual(20);
  expect(await chat.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await editor.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  const navBox = await navigation.boundingBox();
  const attachBox = await editor.getByRole("button", { name: "Attach files", exact: true }).boundingBox();
  if (navBox === null || attachBox === null) throw new Error("Expected editor controls");
  expect(navBox.y + navBox.height).toBeLessThanOrEqual(attachBox.y + 1);
  await page.screenshot({ path: testInfo.outputPath("composer-end.png"), fullPage: true });
  await navigation.getByRole("button", { name: "Jump to top", exact: true }).click();
  await expect.poll(async () => await chat.evaluate((element) => element.scrollTop)).toBe(0);
});

test("native attachment sources and Escape retain the shared popup owner", async ({ page, isMobile }, testInfo) => {
  const editor = page.locator("prompt-editor");
  const attach = editor.getByRole("button", { name: "Attach files", exact: true });
  if (isMobile) {
    await attach.click();
    await expect(editor.getByRole("group", { name: "Attachment source" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(attach).toHaveAttribute("aria-expanded", "false");
    for (const name of ["Photos", "Camera"]) {
      await attach.click();
      const chooserEvent = page.waitForEvent("filechooser");
      await editor.getByRole("button", { name, exact: true }).click();
      const chooser = await chooserEvent;
      await chooser.setFiles({ name: `${name}.png`, mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWQAAAABJRU5ErkJggg==", "base64") });
      await expect(attach).toHaveAttribute("aria-expanded", "false");
    }
    await expect(editor.locator(".attachment-chip")).toHaveCount(2);
    await expect(editor.locator(".attachment-camera-input")).toHaveAttribute("capture", "environment");
    await expect(editor.locator(".attachment-image-input")).not.toHaveAttribute("capture");
  } else {
    const chooserEvent = page.waitForEvent("filechooser");
    await attach.click();
    const chooser = await chooserEvent;
    await chooser.setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Fixture attachment") });
    await expect(editor.locator(".attachment-chip")).toHaveCount(1);
    await expect(attach).not.toHaveAttribute("aria-expanded");
  }
  await page.screenshot({ path: testInfo.outputPath("composer-attachments.png"), fullPage: true });
});

test("completion and Chinese composition never become an accidental send", async ({ page }) => {
  await page.evaluate(() => window.composerFixture.replace(""));
  const editor = page.locator("prompt-editor");
  const input = editor.locator(".cm-content");
  await input.focus();
  await page.keyboard.type("/tr");
  await expect(editor.locator("autocomplete-menu [popover]")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(async () => await page.evaluate(() => window.composerFixture.draft())).toBe("/tree ");
  expect(await page.evaluate(() => window.composerFixture.sendCount())).toBe(0);
  await page.evaluate(() => window.composerFixture.compose());
  expect(await page.evaluate(() => window.composerFixture.sendCount())).toBe(0);
  expect((await page.evaluate(() => window.composerFixture.draft())).trim()).toBe("中文输入");
});

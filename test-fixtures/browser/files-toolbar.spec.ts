import { expect, test } from "@playwright/test";

for (const width of [1280, 360]) {
  test(`restores the default Chinese file toolbar at ${String(width)}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/managed-agents.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const upload = page.getByRole("button", { name: "上传", exact: true });
    await expect(upload).toBeVisible();
    await expect(page.getByRole("button", { name: "新建文件", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("files-default.png") });
    await page.evaluate(() => window.dispatchEvent(new Event("fixture-codex-enable")));
    const customUpload = page.getByRole("button", { name: "上传文件", exact: true });
    await expect(customUpload).toBeVisible();
    await expect(page.getByRole("button", { name: "新建文件", exact: true })).toBeVisible();
    for (const button of await page.locator(".codex-files-toolbar button").all()) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      if (box !== null) { expect(box.width).toBeGreaterThan(0); expect(box.x + box.width).toBeLessThanOrEqual(width); }
    }
    await page.locator("#workspace-upload-input").setInputFiles({ name: "report.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.locator("dialog.upload-dialog")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("files-upload-review.png") });
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.dispatchEvent(new Event("fixture-codex-disable")));
    await expect(upload).toBeVisible();
    await expect(page.getByRole("button", { name: "新建文件", exact: true })).toHaveCount(0);
  });
}

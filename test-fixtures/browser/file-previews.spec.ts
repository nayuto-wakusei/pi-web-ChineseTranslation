import { expect, test } from "@playwright/test";

test("the source editor loads only when Raw is opened", async ({ page }) => {
  const viewerRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/viewerDependencies-[^/]+\.js$/u.test(new URL(request.url()).pathname)) viewerRequests.push(request.url());
  });
  await page.goto("/file-previews.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  expect(viewerRequests).toHaveLength(0);
  await page.getByRole("button", { name: "Text file", exact: true }).click();
  await expect(page.locator("pi-web-files-code-viewer .cm-content")).toHaveText("Original file source");
  expect(viewerRequests).toHaveLength(1);
});

test("registered document previewers preserve native views, isolation, and Raw", async ({ page }) => {
  await page.route("**/fixture-files/preview?*", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path");
    if (path === "diagram.svg") {
      await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="steelblue"/></svg>' });
    } else if (path === "report.html") {
      await route.fulfill({ contentType: "text/html", body: '<h1>Report</h1><script>parent.document.body.dataset.executed = "true"</script>' });
    } else {
      await route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n% fixture\n" });
    }
  });
  await page.goto("/file-previews.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const viewer = page.locator("pi-web-files-viewer");
  await page.getByRole("button", { name: "Image file", exact: true }).click();
  await viewer.getByRole("button", { name: "Preview", exact: true }).click();
  const image = viewer.locator("img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(320);
  await expect(viewer.locator("pi-web-file-previewer pi-web-files-document-preview")).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const box = await image.boundingBox();
    if (box === null) throw new Error("Image preview has no geometry");
    expect(box.width).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  await viewer.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(viewer.locator("img")).toHaveCount(0);
  await expect(viewer.locator("pi-web-files-code-viewer")).toBeVisible();
  await expect(viewer.locator("pi-web-files-code-viewer .cm-content")).toBeVisible();
  await page.getByRole("button", { name: "HTML file", exact: true }).click();
  await viewer.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(viewer.locator("iframe")).toHaveAttribute("sandbox", "");
  await expect(viewer.locator("iframe")).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(viewer.frameLocator("iframe").getByRole("heading", { name: "Report" })).toBeVisible();
  expect(await page.locator("body").getAttribute("data-executed")).toBeNull();
  await page.getByRole("button", { name: "Markdown file", exact: true }).click();
  await expect(viewer.locator(".markdown-preview h1")).toHaveText("Notes");
  await expect(viewer.locator(".markdown-preview script")).toHaveCount(0);
  await expect(viewer.locator("pi-web-file-previewer pi-web-files-document-preview")).toBeVisible();
  await page.getByRole("button", { name: "PDF file", exact: true }).click();
  await expect(viewer.locator("iframe")).toBeVisible();
  await expect(viewer.locator("iframe")).not.toHaveAttribute("sandbox");
  await expect(viewer.getByRole("link", { name: "Download", exact: true })).toBeVisible();
});

test("a contributed audio preview loads, seeks, and gives way to the original file view", async ({ page }) => {
  await page.goto("/file-previews.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Audio file", exact: true }).click();
  const viewer = page.locator("pi-web-files-viewer");
  const player = viewer.locator("audio");
  await expect(player).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Audio", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByRole("button", { name: "Original", exact: true })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Raw", exact: true })).toHaveCount(0);
  await expect(viewer.getByRole("link", { name: "Download", exact: true })).toBeVisible();
  await expect.poll(() => player.evaluate((element: HTMLAudioElement) => element.duration)).toBe(4);
  await player.evaluate((element: HTMLAudioElement) => { element.currentTime = 2; });
  await expect.poll(() => player.evaluate((element: HTMLAudioElement) => !element.seeking && Math.abs(element.currentTime - 2) < 0.05)).toBe(true);
  expect(await player.evaluate((element: HTMLAudioElement) => new URL(element.src).searchParams.get("revision"))).toBe("audio-fixture-r1");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const box = await player.boundingBox();
    const area = await viewer.locator("pi-web-file-previewer").boundingBox();
    if (box === null || area === null) throw new Error("Audio preview has no geometry");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(Math.abs(box.x + box.width / 2 - (area.x + area.width / 2))).toBeLessThan(1);
    expect(Math.abs(box.y + box.height / 2 - (area.y + area.height / 2))).toBeLessThan(1);
  }
  await page.getByRole("button", { name: "Text file", exact: true }).click();
  await expect(player).toHaveCount(0);
  await expect(viewer).toContainText("Original file source");
  await expect(viewer.getByRole("link", { name: "Download", exact: true })).toBeVisible();
});

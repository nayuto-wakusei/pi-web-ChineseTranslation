import { expect, test } from "@playwright/test";

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
  // This test exercises document contributions; no audio request is needed.
  await page.route("**/paired-plugin-backends/pi-web.audio/**", (route) => route.abort());
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


function silentWave(): Buffer {
  const sampleRate = 8_000;
  const sampleBytes = sampleRate * 4 * 2;
  const bytes = Buffer.alloc(44 + sampleBytes);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(sampleBytes, 40);
  return bytes;
}

test("a contributed audio preview loads, seeks, and gives way to the original file view", async ({ page }) => {
  const wave = silentWave();
  const requests: string[] = [];
  await page.route("**/paired-plugin-backends/pi-web.audio/**/resources/audio.read?*", async (route) => {
    requests.push(route.request().url());
    const range = route.request().headers()["range"];
    const match = range === undefined ? null : /^bytes=(\d+)-(\d*)$/u.exec(range);
    const start = match === null ? 0 : Number(match[1]);
    const endText = match?.[2];
    const end = endText === undefined || endText === "" ? wave.length - 1 : Number(endText);
    await route.fulfill({
      status: range === undefined ? 200 : 206,
      headers: { "content-type": "audio/wav", "accept-ranges": "bytes", ...(range === undefined ? {} : { "content-range": `bytes ${String(start)}-${String(end)}/${String(wave.length)}` }) },
      body: wave.subarray(start, end + 1),
    });
  });
  await page.goto("/file-previews.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const viewer = page.locator("pi-web-files-viewer");
  const player = viewer.locator("audio");
  await expect(player).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Audio", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByRole("button", { name: "Original", exact: true })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Raw", exact: true })).toHaveCount(0);
  await expect(viewer.getByRole("link", { name: "Download", exact: true })).toBeVisible();
  await expect.poll(() => player.evaluate((element: HTMLAudioElement) => element.duration)).toBe(4);
  await player.evaluate((element: HTMLAudioElement) => { element.currentTime = 2; });
  await expect.poll(() => player.evaluate((element: HTMLAudioElement) => !element.seeking && element.currentTime)).toBe(2);
  expect(requests.length).toBeGreaterThan(0);
  expect(new URL(requests[0] ?? "").searchParams.get("revision")).toBe("audio-fixture-r1");
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

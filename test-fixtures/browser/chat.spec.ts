import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/chat.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
});

async function readingPosition(page: Page): Promise<number> {
  return await page.locator("chat-view .chat").evaluate((element) => element.scrollTop);
}

async function readMiddle(page: Page): Promise<void> {
  await page.locator("chat-view .chat").evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.5;
  });
  await page.evaluate(() => window.chatFixture.settle());
}

test("long records reach the end and live content does not displace a middle reader", async ({ page }, testInfo) => {
  const chat = page.locator("chat-view .chat");
  await page.getByRole("button", { name: "Jump to end", exact: true }).click();
  await expect.poll(async () => await chat.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);
  const last = page.locator('chat-view article[data-index="159"]');
  await expect(last).toBeVisible();
  const overflow = await chat.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const navigation = await page.locator("chat-view .chat-jumps").boundingBox();
  const dock = await page.locator("chat-view .activity-dock").boundingBox();
  if (navigation === null || dock === null) throw new Error("Missing navigation or activity dock geometry");
  const overlapWidth = Math.max(0, Math.min(navigation.x + navigation.width, dock.x + dock.width) - Math.max(navigation.x, dock.x));
  const overlapHeight = Math.max(0, Math.min(navigation.y + navigation.height, dock.y + dock.height) - Math.max(navigation.y, dock.y));
  expect(overlapWidth * overlapHeight).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("chat-end.png"), fullPage: true });
  await readMiddle(page);
  const before = await readingPosition(page);
  await page.evaluate(() => window.chatFixture.append());
  await expect.poll(() => readingPosition(page)).toBeCloseTo(before, 0);
  await page.screenshot({ path: testInfo.outputPath("chat-middle-streaming.png"), fullPage: true });
});

test("history prepend retains the durable message and its viewport offset", async ({ page }, testInfo) => {
  await readMiddle(page);
  const anchor = await page.locator("chat-view .chat").evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const anchors = [...element.querySelectorAll<HTMLElement>("article[data-scroll-anchor-id]")];
    const visible = anchors.find((article) => article.getBoundingClientRect().top >= top);
    if (visible === undefined) throw new Error("Missing visible durable anchor");
    return { id: visible.getAttribute("data-scroll-anchor-id"), offset: visible.getBoundingClientRect().top - top };
  });
  await page.evaluate(() => window.chatFixture.prepend());
  await expect.poll(async () => await page.locator("chat-view .chat").evaluate((element, identity) => {
    const article = [...element.querySelectorAll<HTMLElement>("article[data-scroll-anchor-id]")].find((candidate) => candidate.getAttribute("data-scroll-anchor-id") === identity.id);
    if (article === undefined) throw new Error("Durable anchor lost after prepend");
    return Math.abs(article.getBoundingClientRect().top - element.getBoundingClientRect().top - identity.offset);
  }, anchor)).toBeLessThan(3);
  await page.screenshot({ path: testInfo.outputPath("chat-prepend-anchor.png"), fullPage: true });
});

test("failed history loading removes its boundary without moving the durable reading anchor", async ({ page }, testInfo) => {
  await readMiddle(page);
  const anchor = await page.locator("chat-view .chat").evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const article = [...element.querySelectorAll<HTMLElement>("article[data-scroll-anchor-id]")]
      .find((candidate) => candidate.getBoundingClientRect().top >= top);
    if (article === undefined) throw new Error("Missing durable reading anchor");
    return { id: article.getAttribute("data-scroll-anchor-id"), offset: article.getBoundingClientRect().top - top };
  });
  for (const loading of [true, false]) {
    await page.evaluate((value) => window.chatFixture.loading(value), loading);
    await expect.poll(async () => await page.locator("chat-view .chat").evaluate((element, identity) => {
      const article = [...element.querySelectorAll<HTMLElement>("article[data-scroll-anchor-id]")]
        .find((candidate) => candidate.getAttribute("data-scroll-anchor-id") === identity.id);
      if (article === undefined) throw new Error("Missing reading anchor after loading change");
      return Math.abs(article.getBoundingClientRect().top - element.getBoundingClientRect().top - identity.offset);
    }, anchor)).toBeLessThan(3);
  }
  await page.screenshot({ path: testInfo.outputPath("chat-failed-history-anchor.png"), fullPage: true });
});

test("native disclosures and changing image dimensions remain usable without horizontal overflow", async ({ page }, testInfo) => {
  const group = page.locator("chat-view details.event-group");
  await group.locator("summary").first().click();
  await expect(group.locator(".group-body")).toBeVisible();
  await group.locator("summary").first().click();
  await expect(group.locator(".group-body")).toHaveCount(0);
  await group.locator("summary").first().click();
  await expect(group.locator(".group-body")).toBeVisible();
  const image = page.locator('chat-view article[data-index="110"] pi-web-image-presentation img');
  await image.scrollIntoViewIfNeeded();
  await expect.poll(async () => await image.evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth === 640)).toBe(true);
  const before = await image.boundingBox();
  await page.locator("chat-view .chat").dispatchEvent("wheel", { deltaY: -50 });
  await page.evaluate(() => window.chatFixture.resizeImage());
  await expect.poll(async () => await image.evaluate((element) => element instanceof HTMLImageElement ? element.naturalHeight : 0)).toBe(720);
  const after = await image.boundingBox();
  if (before === null || after === null) throw new Error("Missing rendered image geometry");
  expect(after.height).not.toBeCloseTo(before.height, 0);
  expect(await page.locator("chat-view .chat").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("chat-disclosure-image.png"), fullPage: true });
});

test("a hidden conversation restores its reading position and still supports end navigation", async ({ page }, testInfo) => {
  await readMiddle(page);
  const before = await readingPosition(page);
  await page.evaluate(() => window.chatFixture.hidden(true));
  await expect(page.locator("chat-view")).not.toBeVisible();
  await page.evaluate(() => window.chatFixture.append());
  await page.evaluate(() => window.chatFixture.hidden(false));
  await expect(page.locator("chat-view")).toBeVisible();
  await expect.poll(() => readingPosition(page)).toBeCloseTo(before, 0);
  await page.getByRole("button", { name: "Jump to end", exact: true }).click();
  await expect.poll(async () => await page.locator("chat-view .chat").evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);
  await page.screenshot({ path: testInfo.outputPath("chat-restored.png"), fullPage: true });
});

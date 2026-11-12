import { expect, test, type Page } from "@playwright/test";

const highlighted = "pi-web-highlighted-code .hljs-keyword";

async function prepareReading(page: Page): Promise<void> {
  await page.goto("/code-scroll.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
}

async function recordEntry(page: Page) {
  await page.evaluate(() => window.codeScrollFixture.exitBelow());
  await page.evaluate(() => window.codeScrollFixture.frames());
  const before = await page.evaluate(() => window.codeScrollFixture.enterFromBelow());
  expect(before.blockBottom).toBeLessThan(0);
  await expect(page.locator(highlighted).first()).toBeAttached();
  const samples = await page.evaluate(() => window.codeScrollFixture.stopRecording());
  const after = samples.at(-1);
  if (after === undefined) throw new Error("No scroll geometry recorded");
  return { before, after, samples };
}

async function expectStableEntry(page: Page): Promise<void> {
  const { before, after, samples } = await recordEntry(page);
  // Deferred layout may change the scroll offset by the block's height delta;
  // the visible bottom edge should move only by the requested scroll distance.
  expect(Math.abs(after.blockBottom - before.blockBottom - 360), JSON.stringify({ before, after })).toBeLessThanOrEqual(1);
  for (const sample of samples) {
    expect(sample.blockBottom).toBeGreaterThanOrEqual(before.blockBottom - 1);
    expect(sample.blockBottom).toBeLessThanOrEqual(before.blockBottom + 361);
  }
}

test("deferred long code formatting preserves the reading position when entering from below", async ({ page }) => {
  await prepareReading(page);
  await expect(page.locator("pi-web-content-renderer")).toHaveCount(0);
  await expectStableEntry(page);
});

test("highlighted code preserves the reading position after repeated offscreen exit and reentry", async ({ page }) => {
  await prepareReading(page);
  // Initial deferred formatting has its own regression above; warm the real
  // renderer before testing the independent offscreen visibility transitions.
  await recordEntry(page);
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.evaluate(() => window.codeScrollFixture.exitBelow());
    await expect(page.locator("pi-web-highlighted-code")).toHaveCount(0);
    await page.evaluate(() => window.codeScrollFixture.frames());
    await expectStableEntry(page);
  }
});

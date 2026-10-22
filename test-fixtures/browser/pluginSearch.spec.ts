import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";

test("community plugins remain readable and usable across viewport sizes", async ({ page }, testInfo) => {
  const docsRoot = resolve("docs");
  const externalRequests: string[] = [];
  const browserErrors: string[] = [];
  const names = ["@scope/" + "long-plugin-name-".repeat(8), "second-plugin", "third-plugin"];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.resolve() }, configurable: true,
    });
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "https://docs.fixture.test") {
      const path = resolve(docsRoot, decodeURIComponent(url.pathname).slice(1));
      if (!path.startsWith(docsRoot + sep)) throw new Error("Fixture path escaped docs");
      const contentType = path.endsWith(".html") ? "text/html; charset=utf-8"
        : path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "image/svg+xml";
      await route.fulfill({ body: await readFile(path), contentType });
    } else if (url.origin === "https://registry.npmjs.org") {
      await route.fulfill({ json: { total: names.length, objects: names.map((name, index) => ({
        package: { name, version: "1.0.0", keywords: ["pi-web.dev-plugin", "pi-web-plugin"],
          description: '<img src=x onerror="alert(1)">', publisher: { username: "fixture" },
          date: `2026-10-${String(14 + index)}T12:00:00Z` }, downloads: { monthly: 300 - index },
      })) } });
    } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
      await route.fulfill({ body: "", contentType: "text/css" });
    } else {
      externalRequests.push(url.href);
      await route.abort();
    }
  });
  await page.goto("https://docs.fixture.test/community-plugins.html");
  const search = page.locator("[data-plugin-search]");
  await expect(search.getByRole("status")).toHaveText("已显示 3 个包。");
  await expect(search.locator(".plugin-result")).toHaveCount(3);
  await expect(search.locator("img")).toHaveCount(0);
  await search.locator(".plugin-copy").first().click();
  await expect(search.locator(".plugin-copy-feedback").first()).toHaveText("已复制安装来源。");
  await search.getByRole("combobox").selectOption("updated");
  await expect(search.locator("h3").first()).toHaveText("third-plugin");
  await search.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const rows = await search.locator(".plugin-result").all();
  let previousBottom = 0;
  for (const row of rows) {
    const box = await row.boundingBox();
    if (box === null) throw new Error("Plugin row has no visible layout box");
    expect(box.y).toBeGreaterThanOrEqual(previousBottom);
    previousBottom = box.y + box.height;
  }
  expect(browserErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
  await page.evaluate(() => { window.scrollTo({ top: 0, behavior: "instant" }); });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("community-plugins.png"), fullPage: true });
});

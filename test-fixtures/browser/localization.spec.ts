import { expect, test } from "@playwright/test";

for (const languageTag of ["es", "sv"]) {
  test(`${languageTag} pack can be selected, persists across reload, and fits narrow settings`, async ({ page }) => {
    await page.goto("/localization.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const panel = page.locator("settings-localization-panel");
    await panel.locator("#language").selectOption(languageTag);
    await panel.locator('button[type="submit"]').click();
    await expect(page.locator("html")).toHaveAttribute("lang", languageTag);
    await expect(panel.locator("h3")).toHaveText(languageTag === "es" ? "Idioma y región" : "Språk och region");
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const control of await panel.locator("select, input, button").all()) {
        await control.scrollIntoViewIfNeeded();
        await control.click({ trial: true });
        const box = await control.boundingBox();
        if (box === null) throw new Error("Missing settings control geometry");
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      expect(await panel.evaluate((element) => {
        const section = element.shadowRoot?.querySelector("section");
        return section !== null && section !== undefined && section.scrollWidth <= section.clientWidth + 1;
      })).toBe(true);
    }
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", languageTag);
    await expect(panel.locator("#language")).toHaveValue(languageTag);
  });
}

test("language settings stay reachable by keyboard with long RTL text and a narrow viewport", async ({ page }) => {
  await page.goto("/localization.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const panel = page.locator("settings-localization-panel");
  const language = panel.locator("#language");
  const region = panel.locator("#formatLocale");
  const zone = panel.locator("#timeZone");
  const hours = panel.locator("#hourCycle");
  const apply = panel.locator('button[type="submit"]');
  const reset = panel.locator('button[type="button"]');
  await language.selectOption("ar");
  await region.fill("ar-EG");
  await zone.fill("UTC");
  await hours.selectOption("h23");
  await hours.focus();
  await page.keyboard.press("Tab");
  await expect(apply).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(panel.locator("h3")).toHaveText("إعدادات اللغة والمنطقة في هذا المتصفح لجميع المشاريع والأجهزة");
  await expect(region).toHaveValue("ar-EG");
  await expect(region).toHaveAttribute("dir", "ltr");
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const control of [language, region, zone, hours, apply, reset]) {
      await control.scrollIntoViewIfNeeded();
      await control.click({ trial: true });
      const box = await control.boundingBox();
      if (box === null) throw new Error("Missing settings control geometry");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(await panel.evaluate((element) => {
      const section = element.shadowRoot?.querySelector("section");
      return section !== null && section !== undefined && section.scrollWidth <= section.clientWidth + 1;
    })).toBe(true);
  }
  await zone.fill("Mars/Olympus");
  await apply.click();
  await expect(zone).toBeFocused();
  await expect(zone).toHaveAttribute("aria-invalid", "true");
  await expect(panel.locator('[role="alert"]')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await reset.click();
  await expect(zone).toHaveValue("");
  await expect(hours).toHaveValue("");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(panel.locator('[role="status"]')).toHaveText("Language and region applied.");
  await page.reload();
  await expect(region).toHaveValue("");
  await expect(zone).toHaveValue("");
});

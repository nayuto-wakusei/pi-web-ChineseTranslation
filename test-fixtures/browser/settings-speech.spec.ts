import { expect, test, type Locator, type Page } from "@playwright/test";

const widths = [320, 390, 1366] as const;
const languages = [
  { code: "zh", nav: "语音输入" },
  { code: "en", nav: "Speech" },
] as const;

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const rect = await locator.boundingBox();
  if (rect === null) throw new Error("expected a laid-out element");
  return rect;
}

async function assertNoHorizontalOverflow(locator: Locator, label: string): Promise<void> {
  expect(await locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `${label} overflows horizontally`).toBe(true);
}

async function openSpeechSettings(page: Page, language: string, nav: string) {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto(`/settings.html?lang=${language}&speech=long&enforced=1`);
  const dialog = page.locator("settings-dialog");
  await dialog.locator(".settings-nav").getByRole("button", { name: new RegExp(`^${nav}`) }).click();
  const panel = dialog.locator("settings-speech-panel");
  await expect(panel).toBeVisible();
  return { dialog, panel };
}

/**
 * Exercises the real SettingsDialog -> speech panel path with long seeded values
 * and an environment-enforced endpoint. Geometry is what matters here: DOM-only
 * tests cannot establish layout.
 */
async function assertSpeechGeometry(dialog: Locator, panel: Locator): Promise<void> {
  await assertNoHorizontalOverflow(panel, "speech panel");
  await assertNoHorizontalOverflow(dialog.locator(".settings-content"), "settings content");

  const panelBox = await box(panel);
  const fields = panel.locator("label.ui-form-field");
  await expect(fields).toHaveCount(5);
  const fieldCount = await fields.count();
  for (let index = 0; index < fieldCount; index += 1) {
    const field = fields.nth(index);
    const [fieldBox, headingBox, controlBox, helpBox] = await Promise.all([
      box(field),
      box(field.locator(".field-heading")),
      box(field.locator("input, select")),
      box(field.locator("small").first()),
    ]);
    expect(headingBox.y + headingBox.height, `field ${String(index)}: label overlaps its control`).toBeLessThanOrEqual(controlBox.y + 1);
    expect(controlBox.y + controlBox.height, `field ${String(index)}: control overlaps its help text`).toBeLessThanOrEqual(helpBox.y + 1);
    expect(fieldBox.x + fieldBox.width, `field ${String(index)}: field exceeds the panel`).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    expect(helpBox.x + helpBox.width, `field ${String(index)}: help text exceeds its field`).toBeLessThanOrEqual(fieldBox.x + fieldBox.width + 1);
  }

  // The enforced endpoint keeps its source visible as a badge next to the label,
  // without merging into it or escaping the row.
  const endpointField = fields.first();
  const label = endpointField.locator(".field-heading > span").first();
  const badge = endpointField.locator(".override-badge");
  await expect(badge).toBeVisible();
  const [labelBox, badgeBox, headingBox] = await Promise.all([box(label), box(badge), box(endpointField.locator(".field-heading"))]);
  expect(badgeBox.x + badgeBox.width, "source badge exceeds the panel").toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
  expect(badgeBox.y, "source badge sits above its heading").toBeGreaterThanOrEqual(headingBox.y - 1);
  expect(badgeBox.y + badgeBox.height, "source badge escapes its heading").toBeLessThanOrEqual(headingBox.y + headingBox.height + 1);
  if (Math.abs(badgeBox.y - labelBox.y) < 4) {
    expect(badgeBox.x - (labelBox.x + labelBox.width), "source badge merges into the field label").toBeGreaterThanOrEqual(6);
  } else {
    expect(badgeBox.y, "wrapped source badge overlaps its label").toBeGreaterThanOrEqual(labelBox.y + labelBox.height - 1);
  }
  expect(await badge.evaluate((element) => parseFloat(getComputedStyle(element).borderTopWidth))).toBeGreaterThanOrEqual(1);
}

async function assertActionsReachable(panel: Locator): Promise<void> {
  const panelBox = await box(panel);
  const actions = panel.locator(".ui-form-actions button");
  expect(await actions.count()).toBeGreaterThanOrEqual(2);
  for (const action of await actions.all()) {
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeVisible();
    const actionBox = await box(action);
    expect(actionBox.x).toBeGreaterThanOrEqual(panelBox.x - 1);
    expect(actionBox.x + actionBox.width, "form action exceeds the panel").toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    const hit = await action.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      // `document.elementFromPoint` stops at the outermost shadow host, so walk
      // down through open shadow roots to find what a user would actually hit.
      let element: Element | null = document.elementFromPoint(x, y);
      while (element !== null && element.shadowRoot !== null) {
        const inner = element.shadowRoot.elementFromPoint(x, y);
        if (inner === null || inner === element) break;
        element = inner;
      }
      return {
        ok: element === button || button.contains(element),
        at: `${String(Math.round(rect.top))}-${String(Math.round(rect.bottom))} of ${String(window.innerHeight)}`,
        hit: element === null ? "nothing" : `${element.tagName.toLowerCase()}.${element.className}`,
      };
    });
    expect(hit.ok, `form action is covered by ${hit.hit} at ${hit.at}`).toBe(true);
  }
}

for (const language of languages) {
  test(`speech settings layout and notices stay usable (${language.code})`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    const { dialog, panel } = await openSpeechSettings(page, language.code, language.nav);

    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
      // Show the top of the panel (label/badge row), then the actions.
      await panel.evaluate((element) => { element.scrollIntoView({ block: "start" }); });
      await assertSpeechGeometry(dialog, panel);
      await page.screenshot({ path: testInfo.outputPath(`speech-${language.code}-${String(width)}-top.png`) });
      await assertActionsReachable(panel);
      await page.screenshot({ path: testInfo.outputPath(`speech-${language.code}-${String(width)}-actions.png`) });
    }

    // Error feedback must fit, then a successful save must surface its notice.
    await panel.locator("#speech-language").fill("中文");
    await panel.locator(".ui-form-actions button[type=submit]").click();
    await expect(panel.locator(".notice.error")).toBeVisible();
    await assertNoHorizontalOverflow(panel, "speech panel with an error notice");

    await panel.locator("#speech-language").fill("zh-CN");
    await panel.locator("#speech-model").fill("qwen3-asr-0.6b-ui");
    await panel.locator(".ui-form-actions button[type=submit]").click();
    await expect(panel.locator(".notice.success")).toBeVisible();
    await expect(panel.locator(".notice.info")).toBeVisible();
    await assertNoHorizontalOverflow(panel, "speech panel with save notices");
    await panel.evaluate((element) => { element.scrollIntoView({ block: "start" }); });
    await page.screenshot({ path: testInfo.outputPath(`speech-${language.code}-notices.png`) });

    expect(errors).toEqual([]);
  });
}

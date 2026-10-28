// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initializeLocalization, localization } from "../../localization/browser";
import { SettingsLocalizationPanel, localizationSettingsMessages as messages } from "./SettingsLocalizationPanel";
import { SettingsGeneralPanel } from "./SettingsGeneralPanel";

const releases: (() => void)[] = [];
beforeEach(async () => {
  await localization.setPreferenceDefaults({ language: "en", formatLocale: "en-US" });
  await localization.setPreferences({ language: "en", formatLocale: "en-US" });
});
afterEach(async () => {
  document.body.replaceChildren();
  releases.splice(0).forEach((release) => { release(); });
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
  vi.restoreAllMocks();
});
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected localization control");
  return value;
}
async function mount(): Promise<SettingsLocalizationPanel> {
  const panel = new SettingsLocalizationPanel();
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}
function control(panel: SettingsLocalizationPanel, id: string): HTMLInputElement | HTMLSelectElement {
  return required(panel.renderRoot.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`));
}
function edit(panel: SettingsLocalizationPanel, id: string, value: string): void {
  const field = control(panel, id);
  field.value = value;
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}
async function submit(panel: SettingsLocalizationPanel): Promise<void> {
  required(panel.renderRoot.querySelector("form")).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await localization.ready;
  await panel.updateComplete;
  await panel.updateComplete;
}
function addGerman(load = () => Promise.resolve({ heading: "Sprache und Region", apply: "Hier anwenden" })): void {
  releases.push(localization.registerCatalog({ id: "settings-language-test", namespace: "core.settingsLocalization", locale: "de", load }));
}

it("is available inside General even while gateway and machine configuration are unavailable", async () => {
  const general = new SettingsGeneralPanel();
  general.loading = true;
  general.machineLoading = true;
  document.body.append(general);
  await general.updateComplete;
  const panel = required(general.renderRoot.querySelector<SettingsLocalizationPanel>("settings-localization-panel"));
  await panel.updateComplete;
  expect(control(panel, "formatLocale").disabled).toBe(false);
});

it("discovers language packs lazily and applies independent preferences, live metadata and persistence", async () => {
  const load = vi.fn(() => Promise.resolve({ heading: "Sprache und Region", apply: "Hier anwenden" }));
  addGerman(load);
  releases.push(await initializeLocalization(localization, window, true));
  await localization.setPreferences({ language: "en", formatLocale: "en-US" });
  const panel = await mount();
  expect(control(panel, "language").querySelector('option[value="de"]')?.textContent).toContain("German");
  expect(load).not.toHaveBeenCalled();
  edit(panel, "language", "de");
  edit(panel, "formatLocale", "ar-EG");
  edit(panel, "timeZone", "Asia/Tokyo");
  edit(panel, "hourCycle", "h23");
  expect(localization.preferences.language).toBe("en");
  await submit(panel);
  expect(localization.preferences).toEqual({ language: "de", formatLocale: "ar-EG", timeZone: "Asia/Tokyo", hourCycle: "h23" });
  expect(panel.renderRoot.querySelector("h3")?.textContent).toBe("Sprache und Region");
  expect(panel.renderRoot.querySelector(".ui-settings-summary")?.textContent).toContain(new Intl.NumberFormat("ar-EG").format(12345.67));
  expect(document.documentElement.lang).toBe("de");
  expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "{}")).toEqual(localization.preferences);
  expect(load).toHaveBeenCalledOnce();
  expect(panel.renderRoot.querySelector('[role="status"]')?.textContent).toBe(messages.t("saved"));
});

it("shows only installed languages for an unavailable browser preference and applies the displayed fallback", async () => {
  await localization.setPreferences({ language: "sv-SE", formatLocale: "sv-SE" });
  const panel = await mount();
  const language = control(panel, "language");
  expect([...language.querySelectorAll("option")].map((option) => option.value)).toEqual(["en"]);
  expect(language.value).toBe("en");
  expect(control(panel, "formatLocale").value).toBe("sv-SE");
  // Opening settings does not overwrite a browser preference.
  expect(localization.preferences.language).toBe("sv-SE");
  await submit(panel);
  expect(localization.preferences).toEqual({ language: "en", formatLocale: "sv-SE" });
});

it("updates installed choices live and falls back when a selected pack is removed without losing other edits", async () => {
  const panel = await mount();
  addGerman();
  await localization.ready;
  await panel.updateComplete;
  expect(control(panel, "language").querySelector('option[value="de"]')).not.toBeNull();
  edit(panel, "language", "de");
  edit(panel, "formatLocale", "sv-SE");
  releases.splice(0).forEach((release) => { release(); });
  await localization.ready;
  await panel.updateComplete;
  const language = control(panel, "language");
  expect([...language.querySelectorAll("option")].map((option) => option.value)).toEqual(["en"]);
  expect(language.value).toBe("en");
  expect(control(panel, "formatLocale").value).toBe("sv-SE");
  await submit(panel);
  expect(localization.preferences).toEqual({ language: "en", formatLocale: "sv-SE" });
});

it.each([["formatLocale", "en_bad", "invalidRegion"], ["timeZone", "Mars/Olympus", "invalidZone"]] as const)("validates %s, focuses and describes the error without changing preferences", async (id, value, key) => {
  const panel = await mount();
  const before = localization.preferences;
  edit(panel, id, value);
  await submit(panel);
  const field = control(panel, id);
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(field.getAttribute("aria-describedby")).toContain("localization-validation");
  expect(panel.shadowRoot?.activeElement).toBe(field);
  expect(panel.renderRoot.querySelector('[role="alert"]')?.textContent).toBe(messages.t(key));
  expect(localization.preferences).toEqual(before);
  await localization.setPreferences({ language: "ar-XB", formatLocale: "en-US" });
  await panel.updateComplete;
  expect(field.value).toBe(value);
  expect(panel.renderRoot.querySelector('[role="alert"]')?.textContent).toBe(messages.t(key));
});

it("keeps drafts and focus across catalog/pseudo changes, and releases disconnected observers", async () => {
  const panel = await mount();
  edit(panel, "formatLocale", "de-DE");
  const field = control(panel, "formatLocale");
  field.focus();
  for (const language of ["en-XA", "ar-XB", "en"]) {
    await localization.setPreferences({ language, formatLocale: "en-GB" });
    await panel.updateComplete;
    expect(control(panel, "formatLocale")).toBe(field);
    expect(field.value).toBe("de-DE");
    expect(panel.shadowRoot?.activeElement).toBe(field);
    expect(panel.renderRoot.querySelector("h3")?.textContent).toBe(messages.t("heading"));
    expect(field.dir).toBe("ltr");
  }
  panel.remove();
  const update = vi.spyOn(panel, "requestUpdate");
  await localization.setPreferences({ language: "en-XA", formatLocale: "en-US" });
  expect(update).not.toHaveBeenCalled();
  document.body.append(panel);
  await panel.updateComplete;
  expect(field.value).toBe("de-DE");
  expect(panel.renderRoot.querySelector("h3")?.textContent).toBe(messages.t("heading"));
});

it("saves preferences and keeps controls usable while a catalog loads, then updates translated labels", async () => {
  releases.push(await initializeLocalization(localization, window, true));
  let finish: ((catalog: { heading: string; apply: string }) => void) | undefined;
  const load = vi.fn(() => new Promise<{ heading: string; apply: string }>((resolve) => { finish = resolve; }));
  addGerman(load);
  const panel = await mount();
  edit(panel, "language", "de");
  required(panel.renderRoot.querySelector("form")).dispatchEvent(new Event("submit", { cancelable: true }));
  await panel.updateComplete;
  await panel.updateComplete;
  expect([...panel.renderRoot.querySelectorAll("button, input, select")].every((control) => !control.hasAttribute("disabled"))).toBe(true);
  expect(panel.renderRoot.querySelector('button[type="submit"]')?.textContent).toBe(messages.t("apply"));
  expect(localization.preferences.language).toBe("de");
  expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual({ language: "de" });
  required(finish)({ heading: "Sprache und Region", apply: "Hier anwenden" });
  await localization.ready;
  await panel.updateComplete;
  expect(control(panel, "language").disabled).toBe(false);
  expect(panel.renderRoot.querySelector("h3")?.textContent).toBe("Sprache und Region");
  expect(load).toHaveBeenCalledOnce();
});

it.each([
  { formatLocale: "en-US", hourCycle: undefined, selected: "" },
  { formatLocale: "sv-SE", hourCycle: undefined, selected: "" },
  { formatLocale: "en-US", hourCycle: "h11", selected: "h12" },
  { formatLocale: "sv-SE", hourCycle: "h24", selected: "h23" },
] as const)("offers only conventional clock formats for $formatLocale / $hourCycle", async ({ formatLocale, hourCycle, selected }) => {
  await localization.setPreferences({ language: "en", formatLocale, ...(hourCycle ? { hourCycle } : {}) });
  const panel = await mount();
  const clock = control(panel, "hourCycle");
  expect([...clock.querySelectorAll("option")].map((option) => option.value)).toEqual(["", "h12", "h23"]);
  expect(clock.value).toBe(selected);
  expect(localization.preferences.hourCycle).toBe(hourCycle);
  await submit(panel);
  expect(localization.preferences.hourCycle).toBe(hourCycle ? selected : undefined);
});

it("applies either clock choice using conventional midnight formatting", async () => {
  await localization.setPreferences({ language: "en", formatLocale: "en-US", timeZone: "UTC" });
  const panel = await mount();
  const midnight = new Date("2026-01-01T00:00:00Z");
  for (const [cycle, text] of [["h23", "00:00"], ["h12", "12:00 AM"]] as const) {
    edit(panel, "hourCycle", cycle);
    await submit(panel);
    expect(localization.preferences.hourCycle).toBe(cycle);
    expect(localization.time(midnight, { hour: "2-digit", minute: "2-digit" })).toBe(text);
  }
  edit(panel, "hourCycle", "");
  await submit(panel);
  expect(localization.preferences.hourCycle).toBeUndefined();
  expect(control(panel, "hourCycle").value).toBe("");
});

it.each([
  { defaults: {}, source: "browserDefault", region: "sv-SE", zone: new Intl.DateTimeFormat().resolvedOptions().timeZone },
  { defaults: { formatLocale: "de-DE", timeZone: "Europe/Berlin" }, source: "gatewayDefault", region: "de-DE", zone: "Europe/Berlin" },
] as const)("keeps inherited fields empty, shows $source values, and saves only overrides", async ({ defaults, source, region, zone }) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["sv-SE"]);
  releases.push(await initializeLocalization(localization, window, true, defaults));
  const panel = await mount();
  expect(control(panel, "formatLocale").value).toBe("");
  expect(control(panel, "timeZone").value).toBe("");
  expect(control(panel, "formatLocale").getAttribute("aria-describedby")).toContain("region-default");
  const label = source === "gatewayDefault" ? "Gateway default" : "Browser default";
  expect(panel.renderRoot.querySelector("#region-default")?.textContent).toBe(`${label}: ${region}`);
  expect(panel.renderRoot.querySelector("#zone-default")?.textContent).toBe(`${label}: ${zone}`);
  expect(panel.renderRoot.querySelector("#zone-default bdi")?.getAttribute("dir")).toBe("ltr");
  expect(localStorage.getItem("pi-web-localization")).toBeNull();
  edit(panel, "formatLocale", "ar-EG");
  edit(panel, "timeZone", "Asia/Tokyo");
  await submit(panel);
  expect(localization.preferences.formatLocale).toBe("ar-EG");
  expect(localization.preferences.timeZone).toBe("Asia/Tokyo");
  edit(panel, "formatLocale", "  ");
  edit(panel, "timeZone", "");
  await submit(panel);
  expect(control(panel, "formatLocale").value).toBe("");
  expect(control(panel, "timeZone").value).toBe("");
  expect(localization.preferences.formatLocale).toBe(region);
  expect(localization.preferences.timeZone).toBe(defaults.timeZone);
  expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "{}")).toEqual({});
  expect(panel.renderRoot.querySelector(".ui-form-field button")).toBeNull();
});

it("uses defaults by removing all explicit preferences, including invalid unsubmitted edits", async () => {
  await localization.setPreferences({ language: "en", formatLocale: "ar-EG", timeZone: "UTC", hourCycle: "h24" });
  const panel = await mount();
  edit(panel, "timeZone", "unsubmitted-invalid-draft");
  required(panel.renderRoot.querySelector<HTMLButtonElement>('footer button[type="button"]')).click();
  await localization.ready;
  await panel.updateComplete;
  expect(localization.preferenceOverrides).toEqual({});
  expect(localization.preferences).toEqual(localization.preferenceDefaults);
  expect(control(panel, "formatLocale").value).toBe("");
  expect(control(panel, "timeZone").value).toBe("");
  expect(control(panel, "hourCycle").value).toBe("");
  expect(panel.renderRoot.querySelector('[role="status"]')?.textContent).toBe(messages.t("saved"));
});

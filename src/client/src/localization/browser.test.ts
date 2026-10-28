// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { html, LitElement, render } from "lit";
import { configureLocalizationPolicy, initializeLocalization, inheritedLocalizationSetting, localizationPolicyFromConfig, LocalizationController } from "./browser.js";
import { LocalizationService, message, type RichMessageTag } from "./service.js";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
  vi.restoreAllMocks();
});

describe("browser localization boundary", () => {
  it("applies initial and refreshed gateway enforcement without persisting effective values", async () => {
    const local = { language: "en", formatLocale: "de-DE", timeZone: "Europe/Berlin", hourCycle: "h12" as const };
    localStorage.setItem("pi-web-localization", JSON.stringify(local));
    const response = {
      effectiveConfig: { defaultLocalization: { language: "fr", formatLocale: "fr-FR", timeZone: "UTC", hourCycle: "h23" as const } },
      enforcedSettings: { "/defaultLocalization/formatLocale": "FORMAT_ENV", "/defaultLocalization/hourCycle": "HOUR_ENV" },
      configSources: { "/defaultLocalization/formatLocale": "environment", "/defaultLocalization/language": "config" },
    };
    const service = new LocalizationService();
    const dispose = await initializeLocalization(service, window, false, Promise.resolve(response.effectiveConfig.defaultLocalization), Promise.resolve(localizationPolicyFromConfig(response)));
    try {
      expect(service.preferences).toEqual({ ...local, formatLocale: "fr-FR", hourCycle: "h23" });
      expect(localStorage.getItem("pi-web-localization")).toBe(JSON.stringify(local));
      expect(service.preferenceSettingPolicy("formatLocale")).toEqual({ locked: true, enforcedBy: "FORMAT_ENV", source: "environment" });
      expect(service.preferenceSettingPolicy("language")).toEqual({ locked: false, enforcedBy: undefined, source: "config" });
      await service.setPreferenceOverrides({ ...service.preferences, timeZone: "UTC" });
      const saved = { ...local, timeZone: "UTC" };
      expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual(saved);
      await configureLocalizationPolicy({ ...response, effectiveConfig: { defaultLocalization: { formatLocale: "sv-SE", hourCycle: "h24" } } }, service);
      expect(service.preferences).toEqual({ ...saved, formatLocale: "sv-SE", hourCycle: "h24" });
      expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual(saved);
      await configureLocalizationPolicy({ effectiveConfig: {} }, service);
      expect(service.preferences).toEqual(saved);
      expect(service.preferenceSettingPolicy("formatLocale").locked).toBe(false);
    } finally { dispose(); }
  });

  it("restores separate preferences, updates document metadata and persists live changes", async () => {
    localStorage.setItem("pi-web-localization", JSON.stringify({ language: "ar", formatLocale: "de-DE", timeZone: "UTC" }));
    const service = new LocalizationService();
    const messages = service.registerMessages("test", { cancel: message("Cancel", "Cancel the operation") });
    service.registerCatalog({ id: "ar", namespace: "test", locale: "ar", load: () => Promise.resolve({ cancel: "إلغاء" }) });
    const dispose = await initializeLocalization(service, window, false);
    await service.ready;
    expect(messages.t("cancel")).toBe("إلغاء");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(service.preferences.formatLocale).toBe("de-DE");
    await service.setPreferences({ language: "en", formatLocale: "en-GB", hourCycle: "h12" });
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "{}")).toEqual(service.preferences);
    dispose();
    await service.setPreferences({ language: "ar", formatLocale: "en-GB" });
    expect(document.documentElement.lang).toBe("en");
  });

  it("reports corrupt storage, uses browser defaults and keeps query pseudo modes out of saved preferences", async () => {
    localStorage.setItem("pi-web-localization", "null");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = new LocalizationService({ development: true });
    const dispose = await initializeLocalization(service, { localStorage, document, navigator,
      location: { search: "?pseudoLocale=ar-XB" } }, true);
    expect(warn).toHaveBeenCalledOnce();
    expect(service.language).toBe("ar-XB");
    expect(document.documentElement.dir).toBe("rtl");
    expect(localStorage.getItem("pi-web-localization")).toBe("null");
    dispose();
  });

  it("inherits independent gateway defaults without persisting them until the user changes preferences", async () => {
    const service = new LocalizationService();
    const defaults = { language: "fr", timeZone: "UTC", hourCycle: "h23" as const };
    let dispose = await initializeLocalization(service, window, false, defaults);
    expect(service.preferences).toEqual({ ...defaults, formatLocale: navigator.languages[0] ?? navigator.language });
    expect(localStorage.getItem("pi-web-localization")).toBeNull();
    const release = service.registerCatalog({ id: "default-test", namespace: "test", locale: "fr", load: () => Promise.resolve({}) });
    await service.ready;
    expect(localStorage.getItem("pi-web-localization")).toBeNull();
    await service.setPreferences({ language: "en", formatLocale: "de-DE" });
    expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual({ language: "en", formatLocale: "de-DE" });
    dispose();
    release();
    const restored = new LocalizationService();
    dispose = await initializeLocalization(restored, window, false, { language: "ar", formatLocale: "ar-EG", timeZone: "UTC" });
    expect(restored.preferences).toEqual({ language: "en", formatLocale: "de-DE", timeZone: "UTC" });
    dispose();
  });

  it("persists preferences immediately while a translation pack remains pending", async () => {
    const service = new LocalizationService();
    const dispose = await initializeLocalization(service, window, false);
    const remove = service.registerCatalog({ id: "stalled", namespace: "absent-plugin", locale: "fr", load: () => new Promise(() => undefined) });
    try {
      void service.setPreferenceOverrides({ language: "fr", formatLocale: "sv-SE" });
      expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual({ language: "fr", formatLocale: "sv-SE" });
      expect(document.documentElement.lang).toBe("en");
      await service.setPreferenceOverrides({ language: "en" });
      expect(service.preferences.formatLocale).toBe(navigator.languages[0] ?? navigator.language);
      expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual({ language: "en" });
    } finally { remove(); dispose(); }
  });

  it("persists cleared overrides without freezing inherited values and refreshes them on reload", async () => {
    const service = new LocalizationService();
    let dispose = await initializeLocalization(service, window, false, { formatLocale: "de-DE", timeZone: "Europe/Berlin" });
    expect(service.preferenceOverrides).toEqual({});
    expect(inheritedLocalizationSetting("formatLocale", service)).toEqual({ source: "server", value: "de-DE" });
    await service.setPreferenceOverrides({ language: "en", formatLocale: "ar-EG", timeZone: "UTC" });
    await service.setPreferenceOverrides({ language: "en" });
    expect(service.preferences).toEqual({ language: "en", formatLocale: "de-DE", timeZone: "Europe/Berlin" });
    expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual({ language: "en" });
    dispose();
    const restored = new LocalizationService();
    dispose = await initializeLocalization(restored, window, false, { formatLocale: "en-GB" });
    expect(restored.preferenceOverrides).toEqual({ language: "en" });
    expect(restored.preferences).toEqual({ language: "en", formatLocale: "en-GB" });
    expect(inheritedLocalizationSetting("timeZone", restored)).toEqual({ source: "browser", value: new Intl.DateTimeFormat().resolvedOptions().timeZone });
    dispose();
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["sv-SE"]);
    dispose = await initializeLocalization(restored, window, false);
    expect(restored.preferences).toEqual({ language: "en", formatLocale: "sv-SE" });
    expect(inheritedLocalizationSetting("formatLocale", restored)).toEqual({ source: "browser", value: "sv-SE" });
    dispose();
  });

  it("applies late defaults per field without replacing edits or persisting inherited values", async () => {
    let resolveDefaults: ((defaults: { formatLocale: string; timeZone: string }) => void) | undefined;
    const pending = new Promise<{ formatLocale: string; timeZone: string }>((resolve) => { resolveDefaults = resolve; });
    const service = new LocalizationService();
    const initialization = initializeLocalization(service, window, false, pending);
    await service.ready;
    await Promise.resolve();
    await service.setPreferenceOverrides({ formatLocale: "sv-SE" });
    if (resolveDefaults === undefined) throw new Error("Missing defaults resolver");
    resolveDefaults({ formatLocale: "de-DE", timeZone: "Europe/Berlin" });
    const dispose = await initialization;
    expect(service.preferences.formatLocale).toBe("sv-SE");
    expect(service.preferences.timeZone).toBe("Europe/Berlin");
    expect(service.preferenceOverrides).toEqual({ formatLocale: "sv-SE" });
    expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual({ formatLocale: "sv-SE" });
    dispose();
  });

  it("keeps a browser edit made before enforcement arrives and restores it on unlock", async () => {
    let resolveDefaults!: (defaults: { formatLocale: string }) => void;
    const pending = new Promise<{ formatLocale: string }>((resolve) => { resolveDefaults = resolve; });
    const service = new LocalizationService();
    const initialization = initializeLocalization(service, window, false, pending, { enforcedFields: { formatLocale: "FORMAT_ENV" } });
    await Promise.resolve();
    await service.setPreferenceOverrides({ formatLocale: "de-DE" });
    resolveDefaults({ formatLocale: "fr-FR" });
    const dispose = await initialization;
    try {
      expect(service.preferences.formatLocale).toBe("fr-FR");
      expect(service.preferenceOverrides).toEqual({ formatLocale: "de-DE" });
      expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual({ formatLocale: "de-DE" });
      await configureLocalizationPolicy({ effectiveConfig: {} }, service);
      expect(service.preferences.formatLocale).toBe("de-DE");
    } finally { dispose(); }
  });

  it("uses updated gateway defaults on reload when no device choice exists", async () => {
    let service = new LocalizationService();
    let dispose = await initializeLocalization(service, window, false, { formatLocale: "de-DE" });
    expect(service.preferences.formatLocale).toBe("de-DE");
    dispose();
    service = new LocalizationService();
    dispose = await initializeLocalization(service, window, false, { formatLocale: "en-GB" });
    expect(service.preferences.formatLocale).toBe("en-GB");
    expect(service.preferences.language).toBe(navigator.languages[0] ?? navigator.language);
    expect(service.preferences.timeZone).toBeUndefined();
    dispose();
  });

  it("keeps development query overrides out of inherited defaults and saved user changes", async () => {
    const service = new LocalizationService({ development: true });
    const dispose = await initializeLocalization(service, { localStorage, document, navigator,
      location: { search: "?pseudoLocale=ar-XB" } }, true, { language: "fr", formatLocale: "de-DE" });
    expect(service.language).toBe("ar-XB");
    expect(localStorage.getItem("pi-web-localization")).toBeNull();
    await service.setPreferences({ ...service.preferences, hourCycle: "h12" });
    expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual({ language: "fr", formatLocale: "de-DE", hourCycle: "h12" });
    dispose();
  });

  it.each(["unchanged", "changed"])("keeps an explicit %s browser choice made while gateway defaults are pending", async (choice) => {
    let resolveDefaults: ((defaults: { formatLocale: string }) => void) | undefined;
    const pending = new Promise<{ formatLocale: string }>((resolve) => { resolveDefaults = resolve; });
    const service = new LocalizationService();
    const initialization = initializeLocalization(service, window, false, pending);
    await service.ready;
    await Promise.resolve();
    const selected = choice === "unchanged" ? { ...service.preferences } : { language: "en", formatLocale: "en-GB" };
    await service.setPreferences(selected);
    expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual(selected);
    if (resolveDefaults === undefined) throw new Error("Missing defaults resolver");
    resolveDefaults({ formatLocale: "de-DE" });
    const dispose = await initialization;
    expect(service.preferences).toEqual(selected);
    dispose();
  });

  it("updates connected Lit hosts on locale changes and safely renders only caller-provided markup", async () => {
    const service = new LocalizationService({ development: true });
    const messages = service.registerMessages("test", {
      text: message<{ name: string; strong: RichMessageTag }>("Hello <strong>{name}</strong>", "Emphasized user name"),
    });
    class LocalizedTest extends LitElement {
      readonly localization = new LocalizationController(this, service);
      protected override render() {
        return html`<p>${messages.rich("text", { name: "<img src=x onerror=alert(1)>", strong: (parts) => html`<strong>${parts}</strong>` })}</p>`;
      }
    }
    customElements.define("localized-foundation-test", LocalizedTest);
    const element = new LocalizedTest();
    document.body.append(element);
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector("strong")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(element.shadowRoot?.querySelector("img")).toBeNull();
    await service.setPreferences({ language: "en-XA", formatLocale: "en" });
    await element.updateComplete;
    expect(element.shadowRoot?.textContent).toContain("Hëllö");
    element.remove();
    const requestUpdate = vi.spyOn(element, "requestUpdate");
    await service.setPreferences({ language: "en", formatLocale: "en" });
    expect(requestUpdate).not.toHaveBeenCalled();
    document.body.append(element);
    await element.updateComplete;
    expect(element.shadowRoot?.textContent).toContain("Hello");
    // Also prove the formatted text remains a text binding when used directly with Lit.
    render(messages.rich("text", { name: "<script>unsafe</script>", strong: (parts) => html`<b>${parts}</b>` }), document.body);
    expect(document.body.querySelector("script")).toBeNull();
  });
});

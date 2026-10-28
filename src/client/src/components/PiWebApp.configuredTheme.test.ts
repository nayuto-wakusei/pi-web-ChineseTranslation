// @vitest-environment happy-dom

import { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, configApi, piPackagesApi, pluginsApi, type PiWebConfigValues } from "../api";
import { configureThemePolicy, THEME_STORAGE_KEY } from "../theme";
import { PluginRegistry } from "../plugins/registry";
import { PiWebApp } from "./PiWebApp";
import { themeStylesheetFetch } from "./themeStylesheetFetch.testSupport";
import { SettingsDialog } from "./SettingsDialog";
import { configResponse, pluginsResponse } from "./SettingsDialog.testSupport";
import { SettingsThemePanel } from "./settings/SettingsThemePanel";
import { SettingsFileIconThemePanel } from "./settings/SettingsFileIconThemePanel";
import { FILE_ICON_STORAGE_KEY, NO_FILE_ICONS } from "../fileIconPreferences";
import { fileIconsCapabilityToken } from "../fileIconService";
import type { FileIconsCapability } from "../../../plugin-api";


// Mount real settings and theme interactions, leaving unrelated session/socket
// startup out of this component-boundary test.
class ThemeSettingsApp extends PiWebApp {
  override connectedCallback(): void {
    LitElement.prototype.connectedCallback.call(this);
  }
}
customElements.define("theme-settings-test-app", ThemeSettingsApp);

let config: PiWebConfigValues;
let enforcedSettings: Record<string, string>;
const unexpectedRequest = vi.fn(() => Promise.reject(new Error("Theme tests must not make network requests")));

beforeEach(() => {
  unexpectedRequest.mockClear();
  vi.stubGlobal("fetch", themeStylesheetFetch(unexpectedRequest));
  config = { defaultTheme: { themeId: "themes:pi-web-light", auto: false } };
  enforcedSettings = {};
  configureThemePolicy({ effectiveConfig: {} });
  window.history.replaceState(null, "", "/?settings=general");
  vi.spyOn(configApi, "config").mockImplementation((machineId) => Promise.resolve({ ...configResponse(machineId === undefined ? config : {}), enforcedSettings: machineId === undefined ? enforcedSettings : {} }));
  vi.spyOn(configApi, "updateConfig").mockImplementation((update) => {
    config = { ...config, ...update.set };
    return Promise.resolve({ ...configResponse(config), enforcedSettings });
  });
  vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([]));
  vi.spyOn(piPackagesApi, "packages").mockResolvedValue({ packages: [] });
  vi.spyOn(api, "runtime").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "now", capabilities: [] });
  // Layout/transport work is unrelated to preferences; never open real sockets.
  vi.stubGlobal("WebSocket", class {
    static readonly CONNECTING = 0;
    readyState = 1;
    close(): void { this.readyState = 3; }
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  configureThemePolicy({ effectiveConfig: {} });
  sessionStorage.clear();
  document.documentElement.removeAttribute("data-pi-web-theme");
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(unexpectedRequest).not.toHaveBeenCalled();
});

describe("app theme defaults and device overrides", () => {
  it.each([false, true])("shows the implicit plugin default before and after clearing a device override (override=%s)", async (hasOverride) => {
    config = {};
    if (hasOverride) localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ themeId: "themes:classic", auto: false }));
    const app = await mountApp(true);
    const panel = themePanel(app);
    const expectedDefault = { themeId: "pi-web.custom-ui-codex:graphite", auto: true };
    expect(panel.defaultPreference).toEqual(expectedDefault);
    expect(panel.shadowRoot?.querySelector(".current-theme")?.textContent).toContain("Default: Graphite");
    expect(document.documentElement.dataset["piWebTheme"]).toBe(hasOverride ? "themes:classic" : expectedDefault.themeId);
    if (hasOverride) {
      button(panel, "Use the default").click();
      await app.updateComplete;
      await settings(app).updateComplete;
      await panel.updateComplete;
    }
    expect(panel.preference).toEqual(expectedDefault);
    expect(panel.defaultPreference).toEqual(panel.preference);
    expect(document.documentElement.dataset["piWebTheme"]).toBe(expectedDefault.themeId);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(config).toEqual({});
    expect(configApi.updateConfig).not.toHaveBeenCalled();
  });

  it("keeps the upstream implicit default when the custom UI themes are unavailable", async () => {
    config = {};
    const app = await mountApp();
    expect(themePanel(app).defaultPreference).toEqual(themePanel(app).preference);
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:pi-web-dark");
  });

  it("provides live file icons to plugins and keeps their browser selection independent of color themes", async () => {
    const app = await mountApp();
    // Isolated startup skips runtime discovery; allow gateway contributions in recovery mode.
    const mode: unknown = Reflect.get(app, "verifiedPluginModeByMachine");
    const registry: unknown = Reflect.get(app, "plugins");
    if (!(mode instanceof Map) || !(registry instanceof PluginRegistry)) throw new Error("Expected app plugin host");
    mode.set("local", "recovery-disabled");
    let icons: FileIconsCapability | undefined;
    await registry.register({ id: "icon-consumer", plugin: {
      apiVersion: 5, name: "Icons", requires: [fileIconsCapabilityToken],
      activate: () => ({ contributions: { fileIconThemes: [{ id: "custom", name: "Custom", file: { url: "https://icons.test/dark.svg", lightUrl: "https://icons.test/light.svg" } }] },
        start: ({ capabilities }) => { icons = capabilities.resolve(fileIconsCapabilityToken); },
      }),
    } });
    app.requestUpdate();
    await app.updateComplete;
    await settings(app).updateComplete;
    const panel = settings(app).shadowRoot?.querySelector("settings-general-panel")?.querySelector<SettingsFileIconThemePanel>("settings-file-icon-theme-panel");
    if (panel == null || icons === undefined) throw new Error("Expected app-provided icons and Appearance settings");
    await panel.updateComplete;
    const changed = vi.fn();
    const unsubscribe = icons.subscribe(changed);
    const select = panel.shadowRoot?.querySelector("select");
    if (select == null) throw new Error("Expected file icon selector");
    select.value = "icon-consumer:custom";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await app.updateComplete;
    expect(icons.resolveIcon("file.ts")).toBe("https://icons.test/light.svg");
    expect(JSON.parse(localStorage.getItem(FILE_ICON_STORAGE_KEY) ?? "null")).toBe("icon-consumer:custom");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    settings(app).onConfigSaved?.({ defaultTheme: { themeId: "themes:pi-web-dark", auto: false } });
    await app.updateComplete;
    expect(icons.resolveIcon("file.ts")).toBe("https://icons.test/dark.svg");
    expect(changed).toHaveBeenCalledTimes(2);
    settings(app).onSelectFileIconTheme?.(NO_FILE_ICONS);
    expect(icons.resolveIcon("file.ts")).toBeUndefined();
    settings(app).onResetFileIconTheme?.();
    expect(localStorage.getItem(FILE_ICON_STORAGE_KEY)).toBeNull();
    unsubscribe();
  });
  it("uses config without saving it locally, then supports device override and following the default", async () => {
    const app = await mountApp();
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:pi-web-light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    const panel = themePanel(app);
    selectTheme(panel, "themes:classic");
    await panel.updateComplete;
    button(panel, "Use in this browser").click();
    await app.updateComplete;
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:classic");
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null")).toEqual({ themeId: "themes:classic", auto: false });

    // A later config result must not overwrite a choice made on this device.
    settings(app).onConfigSaved?.({ defaultTheme: { themeId: "themes:pi-web-dark", auto: false } });
    await app.updateComplete;
    await panel.updateComplete;
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:classic");
    button(panel, "Use the default").click();
    await app.updateComplete;
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:pi-web-dark");
  });

  it("preserves existing device preferences when setting a different default", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ themeId: "themes:classic", auto: false }));
    const app = await mountApp();
    const panel = themePanel(app);
    selectTheme(panel, "themes:pi-web-dark");
    await panel.updateComplete;
    button(panel, "Set gateway default").click();
    await vi.waitFor(() => { expect(config.defaultTheme).toEqual({ themeId: "themes:pi-web-dark", auto: false }); });
    await app.updateComplete;
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:classic");
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null")).toEqual({ themeId: "themes:classic", auto: false });
  });

  it("applies refreshed enforcement without erasing the saved browser theme", async () => {
    const saved = { themeId: "themes:classic", auto: false };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(saved));
    config.defaultTheme = { themeId: "themes:pi-web-dark", auto: false };
    enforcedSettings = { "/defaultTheme": "PI_WEB_DEFAULT_THEME" };
    const app = await mountApp();
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:pi-web-dark");
    expect(themePanel(app).shadowRoot?.querySelector("select")?.disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null")).toEqual(saved);

    enforcedSettings = {};
    const general = settings(app).shadowRoot?.querySelector("settings-general-panel");
    const refresh = general?.shadowRoot?.querySelector("settings-panel-frame")?.shadowRoot?.querySelector<HTMLButtonElement>('button[title="Refresh settings"]');
    expect(refresh).not.toBeNull();
    refresh?.click();
    await vi.waitFor(() => { expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:classic"); });
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null")).toEqual(saved);
  });

  it("keeps an unavailable saved theme intact while displaying the fallback", async () => {
    const saved = { themeId: "custom:temporarily-missing", auto: true };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(saved));
    const app = await mountApp();
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:classic");
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null")).toEqual(saved);
    expect(themePanel(app).hasLocalOverride).toBe(true);
  });
});

async function mountApp(withCustomUiThemes = false): Promise<ThemeSettingsApp> {
  const app = new ThemeSettingsApp();
  if (withCustomUiThemes) {
    const registry: unknown = Reflect.get(app, "plugins");
    if (!(registry instanceof PluginRegistry)) throw new Error("Expected plugin registry");
    const modes: unknown = Reflect.get(app, "verifiedPluginModeByMachine");
    if (!(modes instanceof Map)) throw new Error("Expected verified plugin modes");
    modes.set("local", "recovery-disabled");
    await registry.register({
      id: "pi-web.custom-ui-codex",
      plugin: { apiVersion: 5, name: "Custom UI themes fixture", activate: () => ({ contributions: {
        themes: [
          { id: "paper", name: "Paper", colorScheme: "light" },
          { id: "graphite", name: "Graphite", colorScheme: "dark" },
        ],
        themePairs: [{ id: "paper-graphite", name: "Paper / Graphite", light: "paper", dark: "graphite" }],
      } }) },
    });
  }
  const appearance = window.matchMedia("(prefers-color-scheme: light)");
  vi.spyOn(appearance, "matches", "get").mockReturnValue(false);
  Reflect.set(app, "systemLightThemeMedia", appearance);
  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  document.body.append(app);
  await app.updateComplete;
  settings(app).onConfigSaved?.(config);
  await vi.waitFor(() => {
    const panel = themePanel(app);
    expect(panel.loading).toBe(false);
    expect(panel.themes.length).toBeGreaterThan(0);
  });
  await app.updateComplete;
  await settings(app).updateComplete;
  await themePanel(app).updateComplete;
  return app;
}

function settings(app: ThemeSettingsApp): SettingsDialog {
  const dialog = app.shadowRoot?.querySelector<SettingsDialog>("settings-dialog");
  if (dialog == null) throw new Error("Expected settings dialog");
  return dialog;
}

function themePanel(app: ThemeSettingsApp): SettingsThemePanel {
  const panel = settings(app).shadowRoot?.querySelector("settings-general-panel")?.querySelector<SettingsThemePanel>("settings-theme-panel");
  if (panel == null) throw new Error("Expected theme settings");
  return panel;
}

function selectTheme(panel: SettingsThemePanel, id: string): void {
  const select = panel.shadowRoot?.querySelector<HTMLSelectElement>("select");
  if (select == null) throw new Error("Expected theme selector");
  select.value = id;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function button(panel: SettingsThemePanel, label: string): HTMLButtonElement {
  const control = [...panel.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? []].find((element) => element.textContent === label);
  if (control === undefined) throw new Error(`Expected ${label}`);
  return control;
}

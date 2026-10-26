// @vitest-environment happy-dom

import { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, configApi, piPackagesApi, pluginsApi, type PiWebConfigValues } from "../api";
import { THEME_STORAGE_KEY } from "../theme";
import { PluginRegistry } from "../plugins/registry";
import { PiWebApp } from "./PiWebApp";
import { themeStylesheetFetch } from "./themeStylesheetFetch.testSupport";
import { SettingsDialog } from "./SettingsDialog";
import { configResponse, pluginsResponse } from "./SettingsDialog.testSupport";
import { SettingsThemePanel } from "./settings/SettingsThemePanel";

// Mount real settings and theme interactions, leaving unrelated session/socket
// startup out of this component-boundary test.
class ThemeSettingsApp extends PiWebApp {
  override connectedCallback(): void {
    LitElement.prototype.connectedCallback.call(this);
  }
}
customElements.define("theme-settings-test-app", ThemeSettingsApp);

let config: PiWebConfigValues;
const unexpectedRequest = vi.fn(() => Promise.reject(new Error("Theme tests must not make network requests")));

beforeEach(() => {
  unexpectedRequest.mockClear();
  vi.stubGlobal("fetch", themeStylesheetFetch(unexpectedRequest));
  config = { defaultTheme: { themeId: "themes:pi-web-light", auto: false } };
  window.history.replaceState(null, "", "/?settings=general");
  vi.spyOn(configApi, "config").mockImplementation((machineId) => Promise.resolve(configResponse(machineId === undefined ? config : {})));
  vi.spyOn(configApi, "saveConfig").mockImplementation((saved) => {
    config = saved;
    return Promise.resolve(configResponse(saved));
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
    expect(panel.shadowRoot?.querySelector(".current-theme")?.textContent).toContain("默认：Graphite");
    expect(document.documentElement.dataset["piWebTheme"]).toBe(hasOverride ? "themes:classic" : expectedDefault.themeId);
    if (hasOverride) {
      button(panel, "使用默认主题").click();
      await app.updateComplete;
      await settings(app).updateComplete;
      await panel.updateComplete;
    }
    expect(panel.preference).toEqual(expectedDefault);
    expect(panel.defaultPreference).toEqual(panel.preference);
    expect(document.documentElement.dataset["piWebTheme"]).toBe(expectedDefault.themeId);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(config).toEqual({});
    expect(configApi.saveConfig).not.toHaveBeenCalled();
  });

  it("keeps the upstream implicit default when the custom UI themes are unavailable", async () => {
    config = {};
    const app = await mountApp();
    expect(themePanel(app).defaultPreference).toEqual(themePanel(app).preference);
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:pi-web-dark");
  });

  it("uses config without saving it locally, then supports device override and following the default", async () => {
    const app = await mountApp();
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:pi-web-light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    const panel = themePanel(app);
    selectTheme(panel, "themes:classic");
    await panel.updateComplete;
    button(panel, "在此浏览器使用").click();
    await app.updateComplete;
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:classic");
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null")).toEqual({ themeId: "themes:classic", auto: false });

    // A later config result must not overwrite a choice made on this device.
    settings(app).onConfigSaved?.({ defaultTheme: { themeId: "themes:pi-web-dark", auto: false } });
    await app.updateComplete;
    await panel.updateComplete;
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:classic");
    button(panel, "使用默认主题").click();
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
    button(panel, "设为网关默认主题").click();
    await vi.waitFor(() => { expect(config.defaultTheme).toEqual({ themeId: "themes:pi-web-dark", auto: false }); });
    await app.updateComplete;
    expect(document.documentElement.dataset["piWebTheme"]).toBe("themes:classic");
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null")).toEqual({ themeId: "themes:classic", auto: false });
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

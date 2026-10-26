// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { themePackPlugin } from "../../plugins/themes";
import { PluginRegistry } from "../../plugins/registry";
import { SettingsThemePanel } from "./SettingsThemePanel";
import type { QualifiedThemeContribution } from "../../plugins/types";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("theme settings controls", () => {
  it.each(["paper", "graphite"])("displays and explicitly saves the available migrated %s theme", async (name) => {
    const panel = await mountPanel();
    const palette = customTheme(name);
    const preference = { themeId: `themes:${name}`, auto: true };
    const useLocal = vi.fn();
    const setDefault = vi.fn();
    panel.preference = preference;
    panel.defaultPreference = preference;
    panel.activeThemeId = palette.id;
    panel.hasLocalOverride = true;
    panel.themes = [...panel.themes, palette];
    panel.onUseLocal = useLocal;
    panel.onSetDefault = setDefault;
    await panel.updateComplete;

    expect(required(panel.shadowRoot?.querySelector("select")).value).toBe(palette.id);
    expect(panel.shadowRoot?.textContent).toContain(`当前：${palette.name}`);
    expect(panel.shadowRoot?.textContent).toContain(`默认：${palette.name}`);
    expect(panel.shadowRoot?.getElementById("theme-unavailable-help")).toBeNull();
    const auto = required(panel.shadowRoot?.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    auto.click();
    await panel.updateComplete;
    expect(useLocal).not.toHaveBeenCalled();
    expect(setDefault).not.toHaveBeenCalled();
    expect(preference).toEqual({ themeId: `themes:${name}`, auto: true });
    button(panel, "在此浏览器使用").click();
    button(panel, "设为网关默认主题").click();
    expect(useLocal).toHaveBeenCalledWith({ themeId: palette.id, auto: false });
    expect(setDefault).toHaveBeenCalledWith({ themeId: palette.id, auto: false });
    expect(panel.preference).toBe(preference);
  });

  it("preserves the requested legacy choice and staged Auto state while its plugin disappears and returns", async () => {
    const panel = await mountPanel();
    const coreThemes = panel.themes;
    const palette = customTheme("graphite");
    const preference = { themeId: "themes:graphite", auto: true };
    panel.preference = preference;
    await panel.updateComplete;
    const select = required(panel.shadowRoot?.querySelector("select"));
    expect(select.value).toBe(preference.themeId);
    expect(button(panel, "在此浏览器使用").disabled).toBe(true);

    panel.themes = [...coreThemes, palette];
    await panel.updateComplete;
    expect(select.value).toBe(palette.id);
    expect(button(panel, "在此浏览器使用").disabled).toBe(false);
    const auto = required(panel.shadowRoot?.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    auto.click();
    await panel.updateComplete;
    panel.themes = coreThemes;
    await panel.updateComplete;
    expect(select.value).toBe(preference.themeId);
    expect(auto.checked).toBe(false);
    expect(button(panel, "在此浏览器使用").disabled).toBe(true);
    expect(button(panel, "设为网关默认主题").disabled).toBe(true);

    panel.themes = [...coreThemes, palette];
    await panel.updateComplete;
    expect(select.value).toBe(palette.id);
    expect(auto.checked).toBe(false);
    expect(button(panel, "在此浏览器使用").disabled).toBe(false);
    expect(preference).toEqual({ themeId: "themes:graphite", auto: true });
  });

  it("selects the saved theme when first opened and when options arrive later", async () => {
    const registry = new PluginRegistry();
    await registry.registerBatch([{ id: "themes", plugin: themePackPlugin }]);
    const themes = registry.getThemes();
    for (const delayed of [false, true]) {
      const panel = new SettingsThemePanel();
      panel.preference = { themeId: "themes:graphite", auto: false };
      panel.themes = delayed ? [] : themes;
      document.body.append(panel);
      await panel.updateComplete;
      if (delayed) {
        panel.themes = themes;
        await panel.updateComplete;
      }
      const select = required(panel.shadowRoot?.querySelector<HTMLSelectElement>("select"));
      expect(select.value).toBe("themes:graphite");
      panel.preference = { themeId: "themes:paper", auto: false };
      await panel.updateComplete;
      expect(select.value).toBe("themes:paper");
      selectTheme(panel, "themes:classic");
      await panel.updateComplete;
      expect(select.value).toBe("themes:classic");
      panel.remove();
    }
    await registry.dispose();
  });

  it("stages theme and Auto choices, then offers distinct browser/default actions", async () => {
    const panel = await mountPanel();
    const useLocal = vi.fn();
    const setDefault = vi.fn();
    const useDefault = vi.fn();
    panel.onUseLocal = useLocal;
    panel.onSetDefault = setDefault;
    panel.onUseDefault = useDefault;
    panel.hasLocalOverride = true;
    await panel.updateComplete;
    selectTheme(panel, "themes:pi-web-light");
    const auto = required(panel.shadowRoot?.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    auto.click();
    await panel.updateComplete;
    expect(useLocal).not.toHaveBeenCalled();
    expect(setDefault).not.toHaveBeenCalled();

    button(panel, "在此浏览器使用").click();
    button(panel, "设为网关默认主题").click();
    button(panel, "使用默认主题").click();
    expect(useLocal).toHaveBeenCalledWith({ themeId: "themes:pi-web-light", auto: false });
    expect(setDefault).toHaveBeenCalledWith({ themeId: "themes:pi-web-light", auto: false });
    expect(useDefault).toHaveBeenCalledOnce();
    expect(panel.preference).toEqual({ themeId: "themes:pi-web-dark", auto: true });
  });

  it("shows the preference source and default independently", async () => {
    const panel = await mountPanel();
    panel.preference = { themeId: "themes:classic", auto: false };
    panel.defaultPreference = { themeId: "themes:pi-web-light", auto: true };
    panel.hasLocalOverride = true;
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain("正在使用此浏览器保存的主题");
    expect(panel.shadowRoot?.textContent).toContain("默认：PI WEB 浅色 · 跟随系统外观");
    panel.hasLocalOverride = false;
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain("正在使用默认主题");
  });

  it("keeps an unavailable requested theme visible rather than saving its fallback", async () => {
    const panel = await mountPanel();
    panel.preference = { themeId: "custom:missing", auto: false };
    panel.hasLocalOverride = true;
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain("custom:missing（不可用）");
    expect(button(panel, "在此浏览器使用").disabled).toBe(true);
    const select = required(panel.shadowRoot?.querySelector("select"));
    const guidance = required(panel.shadowRoot?.getElementById("theme-unavailable-help"));
    expect(select.getAttribute("aria-describedby")).toContain(guidance.id);
    expect(guidance.textContent).toContain("请选择可用主题");
    expect(button(panel, "设为网关默认主题").disabled).toBe(true);
    expect(button(panel, "使用默认主题").disabled).toBe(false);
    selectTheme(panel, "themes:pi-web-light");
    await panel.updateComplete;
    expect(panel.shadowRoot?.getElementById("theme-unavailable-help")).toBeNull();
    expect(button(panel, "在此浏览器使用").disabled).toBe(false);
  });

  it("disables edits while config is loading or saving", async () => {
    const panel = await mountPanel();
    panel.hasLocalOverride = true;
    for (const property of ["loading", "saving"] as const) {
      panel[property] = true;
      await panel.updateComplete;
      expect([...panel.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? []].every((element) => element.disabled)).toBe(true);
      panel[property] = false;
    }
  });
});

function customTheme(name: string): QualifiedThemeContribution {
  return { id: `pi-web.custom-ui-codex:${name}`, pluginId: "pi-web.custom-ui-codex", localId: name, name: name === "paper" ? "Paper" : "Graphite", colorScheme: name === "paper" ? "light" : "dark" };
}

async function mountPanel(): Promise<SettingsThemePanel> {
  const registry = new PluginRegistry();
  await registry.registerBatch([{ id: "themes", plugin: themePackPlugin }]);
  const panel = new SettingsThemePanel();
  panel.themes = registry.getThemes();
  document.body.append(panel);
  await panel.updateComplete;
  await registry.dispose();
  return panel;
}

function selectTheme(panel: SettingsThemePanel, id: string): void {
  const select = required(panel.shadowRoot?.querySelector<HTMLSelectElement>("select"));
  select.value = id;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function button(panel: SettingsThemePanel, label: string): HTMLButtonElement {
  return required([...panel.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? []].find((element) => element.textContent === label));
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected rendered theme control");
  return value;
}

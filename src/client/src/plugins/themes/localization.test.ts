// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { localization } from "../../localization/browser";
import { SettingsThemePanel } from "../../components/settings/SettingsThemePanel";
import { PluginRegistry } from "../registry";
import { themePackPlugin } from "./index";
import definitions from "./themes.messages";

const registries: PluginRegistry[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
  document.body.replaceChildren();
  for (const registry of registries.splice(0)) await registry.dispose();
  for (const release of releases.splice(0)) release();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  localStorage.clear();
});

it("keeps every theme and pair label live while preserving stylesheets, identities and staged settings", async () => {
  // Neutral palettes belong to the optional custom-ui-codex plugin in this fork.
  const coreDefinitions = Object.entries(definitions).filter(([key]) => !/^(paper|graphite|neutralPair)/u.test(key));
  const catalog = Object.fromEntries(coreDefinitions.map(([key, value]) => [key, `Übersetzt '<img>' ${value.message}`]));
  releases.push(localization.registerCatalog({
    id: "themes-test", namespace: "plugin:themes:themes", locale: "de", load: () => Promise.resolve(catalog),
  }));
  const registry = new PluginRegistry();
  registries.push(registry);
  await registry.register({ id: "themes", plugin: themePackPlugin });
  const themes = registry.getThemes();
  const pairs = registry.getThemePairs();
  const contributions = [...themes, ...pairs, ...registry.getFileIconThemes()];
  const originalLabels = contributions.map(({ name, description }) => ({ name, description }));
  const identity = themes.map(({ id, colorScheme, stylesheets }) => ({ id, colorScheme, stylesheets }));
  const pairing = pairs.map(({ id, light, dark }) => ({ id, light, dark }));
  expect(originalLabels.flatMap(({ name, description }) => [name, description])).toEqual(coreDefinitions.map(([, { message }]) => message));

  const panel = new SettingsThemePanel();
  panel.themes = themes;
  panel.onUseLocal = vi.fn();
  document.body.append(panel);
  await panel.updateComplete;
  const select = panel.renderRoot.querySelector("select");
  if (select === null) throw new Error("Expected theme selector");
  select.value = "themes:pi-web-light";
  select.dispatchEvent(new Event("change"));
  await panel.updateComplete;
  select.focus();

  for (const language of ["de", "en-XA", "ar-XB", "en"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    await panel.updateComplete;
    for (const [index, contribution] of contributions.entries()) {
      const original = originalLabels[index];
      if (language === "en") expect({ name: contribution.name, description: contribution.description }).toEqual(original);
      else {
        expect(contribution.name).not.toBe(original?.name);
        expect(contribution.description).not.toBe(original?.description);
      }
    }
    if (language === "de") {
      expect(contributions.flatMap(({ name, description }) => [name, description])).toEqual(Object.values(catalog).map((value) => value.replaceAll("'", "")));
    }
    expect([...select.options].map((option) => option.textContent)).toEqual(themes.map(({ name }) => name));
    expect(panel.renderRoot.querySelector("select")).toBe(select);
    expect(panel.shadowRoot?.activeElement).toBe(select);
    expect(select.value).toBe("themes:pi-web-light");
    expect(panel.renderRoot.querySelector("img")).toBeNull();
    expect(panel.onUseLocal).not.toHaveBeenCalled();
    expect(themes.map(({ id, colorScheme, stylesheets }) => ({ id, colorScheme, stylesheets }))).toEqual(identity);
    expect(pairs.map(({ id, light, dark }) => ({ id, light, dark }))).toEqual(pairing);
  }
  panel.renderRoot.querySelector("button")?.click();
  expect(panel.onUseLocal).toHaveBeenCalledExactlyOnceWith({ themeId: "themes:pi-web-light", auto: true });
});

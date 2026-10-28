// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi, piPackagesApi, pluginsApi } from "../api";
import { PluginRegistry } from "../plugins/registry";
import { themePackPlugin } from "../plugins/themes";
import { SettingsDialog } from "./SettingsDialog";
import { configResponse, pluginsResponse, remoteMachine } from "./SettingsDialog.testSupport";
import { SettingsThemePanel } from "./settings/SettingsThemePanel";

beforeEach(() => {
  vi.spyOn(configApi, "config").mockResolvedValue(configResponse({}));
  vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([]));
  vi.spyOn(piPackagesApi, "packages").mockResolvedValue({ packages: [] });
});

const registries: PluginRegistry[] = [];
afterEach(async () => {
  document.body.replaceChildren();
  for (const registry of registries.splice(0)) await registry.dispose();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("saving a theme default", () => {
  it("keeps a legacy gateway default unchanged until explicitly saving its available plugin theme", async () => {
    const defaultTheme = { themeId: "themes:graphite", auto: true };
    const config = { host: "127.0.0.1", defaultTheme };
    vi.mocked(configApi.config).mockResolvedValue(configResponse(config));
    const save = vi.spyOn(configApi, "updateConfig").mockResolvedValue(configResponse(config));
    const dialog = await mountDialog();
    dialog.themePreference = defaultTheme;
    dialog.themes = [...dialog.themes, {
      id: "pi-web.custom-ui-codex:graphite", pluginId: "pi-web.custom-ui-codex", localId: "graphite", name: "Graphite", colorScheme: "dark",
    }];
    await dialog.updateComplete;
    const panel = themePanel(dialog);
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain("Default: Graphite");
    expect(button(panel, "Set gateway default").disabled).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(defaultTheme).toEqual({ themeId: "themes:graphite", auto: true });
    button(panel, "Set gateway default").click();
    await vi.waitFor(() => { expect(save).toHaveBeenCalledWith({ set: { defaultTheme: { themeId: "pi-web.custom-ui-codex:graphite", auto: true } } }); });
  });

  it("patches only the gateway theme even with a remote machine selected", async () => {
    const dialog = await mountDialog();
    const onSaved = vi.fn();
    dialog.onConfigSaved = onSaved;
    dialog.machine = remoteMachine;
    await dialog.updateComplete;
    const current = { host: "127.0.0.1", shortcuts: { "core:view.chat": "mod+1" }, plugins: { info: { enabled: true } } };
    const defaultTheme = { themeId: "themes:pi-web-dark", auto: true };
    vi.mocked(configApi.config).mockResolvedValue(configResponse(current));
    const save = vi.spyOn(configApi, "updateConfig").mockResolvedValue(configResponse({ ...current, defaultTheme }));
    vi.mocked(configApi.config).mockClear();
    button(themePanel(dialog), "Set gateway default").click();
    await vi.waitFor(() => { expect(save).toHaveBeenCalledWith({ set: { defaultTheme } }); });
    await vi.waitFor(() => { expect(onSaved).toHaveBeenCalledWith({ ...current, defaultTheme }); });
    expect(vi.mocked(configApi.config).mock.calls).not.toContainEqual([]);
    expect(save.mock.calls).toHaveLength(1);
  });

  it("reports a failed save without applying a new default", async () => {
    const dialog = await mountDialog();
    const onSaved = vi.fn();
    dialog.onConfigSaved = onSaved;
    vi.spyOn(configApi, "updateConfig").mockRejectedValue(new Error("Disk is read-only"));
    button(themePanel(dialog), "Set gateway default").click();
    await vi.waitFor(() => { expect(generalPanel(dialog).error).toContain("Couldn't save the default theme: Disk is read-only"); });
    expect(onSaved).not.toHaveBeenCalled();
    expect(themePanel(dialog).defaultPreference).toEqual({ themeId: "themes:pi-web-dark", auto: true });
  });
});

async function mountDialog(): Promise<SettingsDialog> {
  const registry = new PluginRegistry();
  registries.push(registry);
  await registry.registerBatch([{ id: "themes", plugin: themePackPlugin }]);
  const dialog = new SettingsDialog();
  dialog.themes = registry.getThemes();
  document.body.append(dialog);
  await vi.waitFor(() => { expect(themePanel(dialog).loading).toBe(false); });
  await themePanel(dialog).updateComplete;
  return dialog;
}

function generalPanel(dialog: SettingsDialog): import("./settings/SettingsGeneralPanel").SettingsGeneralPanel {
  const panel = dialog.shadowRoot?.querySelector<import("./settings/SettingsGeneralPanel").SettingsGeneralPanel>("settings-general-panel");
  if (panel == null) throw new Error("Expected General settings");
  return panel;
}

function themePanel(dialog: SettingsDialog): SettingsThemePanel {
  const panel = generalPanel(dialog).querySelector<SettingsThemePanel>("settings-theme-panel");
  if (panel == null) throw new Error("Expected theme settings");
  return panel;
}

function button(panel: SettingsThemePanel, label: string): HTMLButtonElement {
  const control = [...panel.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? []].find((element) => element.textContent === label);
  if (control === undefined) throw new Error(`Expected ${label}`);
  return control;
}

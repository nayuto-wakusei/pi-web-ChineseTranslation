// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi, piPackagesApi, pluginsApi } from "../api";
import { settleRenderedDialog } from "./modalSurfaceTestSupport";
import { SettingsDialog } from "./SettingsDialog";
import { setClientTranslations } from "../i18n";
import type { SettingsSessiondPanel } from "./settings/SettingsSessiondPanel";
import type { SettingsPluginsPanel } from "./settings/SettingsPluginsPanel";
import type { SettingsGeneralPanel } from "./settings/SettingsGeneralPanel";
import { configResponse, pluginsResponse } from "./SettingsDialog.testSupport";

beforeEach(() => {
  setClientTranslations("en", {});
  // The dialog loads gateway and selected-machine settings data when it
  // connects; stub those boundary calls so the shell tests stay deterministic.
  vi.spyOn(configApi, "config").mockResolvedValue(configResponse({}));
  vi.spyOn(configApi, "namingModels").mockResolvedValue({ models: [] });
  vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([]));
  vi.spyOn(piPackagesApi, "packages").mockResolvedValue({ packages: [] });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

describe("settings-dialog modal surface", () => {
  it("keeps save confirmations scoped to the section that performed the save", async () => {
    vi.spyOn(configApi, "saveConfig").mockResolvedValue(configResponse({ spawnSessions: false }));
    const dialog = await mountDialog();
    dialog.section = "sessiond";
    await dialog.updateComplete;
    const panel = dialog.shadowRoot?.querySelector<SettingsSessiondPanel>("settings-sessiond-panel");
    if (panel === null || panel === undefined) throw new Error("Session daemon panel missing");
    await panel.onSave?.({ spawnSessions: false });
    await dialog.updateComplete;
    expect(panel.savedMessage).toContain("Restarting interrupts active sessions");
    dialog.section = "plugins";
    await dialog.updateComplete;
    const plugins = dialog.shadowRoot?.querySelector<SettingsPluginsPanel>("settings-plugins-panel");
    expect(plugins?.savedMessage).toBe("");
    dialog.section = "sessiond";
    await dialog.updateComplete;
    expect(dialog.shadowRoot?.querySelector<SettingsSessiondPanel>("settings-sessiond-panel")?.savedMessage).toContain("Session daemon settings saved");
  });

  it("preserves an unsaved gateway edit when switching settings sections", async () => {
    const dialog = await mountDialog();
    const panel = dialog.shadowRoot?.querySelector<SettingsGeneralPanel>("settings-general-panel");
    if (panel === null || panel === undefined) throw new Error("General panel missing");
    await panel.updateComplete;
    const host = panel.shadowRoot?.querySelector<HTMLInputElement>('input[placeholder="127.0.0.1"]');
    if (host === null || host === undefined) throw new Error("Gateway host field missing");
    host.value = "192.168.1.20";
    host.dispatchEvent(new Event("input", { bubbles: true }));
    await panel.updateComplete;
    dialog.section = "plugins";
    await dialog.updateComplete;
    dialog.section = "general";
    await dialog.updateComplete;
    const restored = dialog.shadowRoot?.querySelector<SettingsGeneralPanel>("settings-general-panel");
    expect(restored).toBe(panel);
    await panel.updateComplete;
    expect(host.value).toBe("192.168.1.20");
  });
});

interface SettingsDialogCallbacks {
  onClose?: () => void;
}

async function mountDialog(callbacks: SettingsDialogCallbacks = {}): Promise<SettingsDialog> {
  const dialog = new SettingsDialog();
  Object.assign(dialog, callbacks);
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}

import { describe, expect, it } from "vitest";
import { mergeSelectedMachinePluginConfig, pluginEnabledConfigPatch } from "./settingsPluginConfig";
import { configResponse } from "../SettingsDialog.testSupport";

describe("plugin settings config helpers", () => {
  it("builds plugin-only save patches while preserving existing plugin config", () => {
    const patch = pluginEnabledConfigPatch(
      {
        host: "127.0.0.1",
        plugins: {
          info: { enabled: true, settings: { theme: "dark" }, custom: "keep" },
          metrics: { enabled: false },
        },
      },
      "info",
      false,
    );

    expect(Object.keys(patch)).toEqual(["plugins"]);
    expect(patch).toEqual({
      plugins: {
        info: { enabled: false, settings: { theme: "dark" }, custom: "keep" },
        metrics: { enabled: false },
      },
    });
  });

  it("merges local selected-machine plugin config into gateway config without dropping gateway-only values", () => {
    const gateway = configResponse({
      host: "127.0.0.1",
      port: 8504,
      allowedHosts: ["gateway.local"],
      shortcuts: { "core:view.chat": "mod+1" },
      spawnSessions: false,
      plugins: { info: { enabled: false } },
    });
    const selectedMachine = configResponse({ plugins: { info: { enabled: true }, metrics: { enabled: false } } });

    expect(mergeSelectedMachinePluginConfig(gateway, selectedMachine)).toEqual({
      ...gateway,
      config: {
        host: "127.0.0.1",
        port: 8504,
        allowedHosts: ["gateway.local"],
        shortcuts: { "core:view.chat": "mod+1" },
        spawnSessions: false,
        plugins: { info: { enabled: true }, metrics: { enabled: false } },
      },
      effectiveConfig: {
        host: "127.0.0.1",
        port: 8504,
        allowedHosts: ["gateway.local"],
        shortcuts: { "core:view.chat": "mod+1" },
        spawnSessions: false,
        plugins: { info: { enabled: true }, metrics: { enabled: false } },
      },
    });
  });
});

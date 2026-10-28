import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { mergeSelectedSettingsResponse } from "./settingsConfigUpdate";

export function pluginEnabledConfigPatch(baseConfig: PiWebConfigValues, pluginId: string, enabled: boolean): PiWebConfigValues {
  const currentPlugins = baseConfig.plugins ?? {};
  const currentPluginConfig = currentPlugins[pluginId] ?? {};
  return {
    plugins: {
      ...currentPlugins,
      [pluginId]: { ...currentPluginConfig, enabled },
    },
  };
}

export function mergeSelectedMachinePluginConfig(base: PiWebConfigResponse, selectedMachine: PiWebConfigResponse): PiWebConfigResponse {
  return mergeSelectedSettingsResponse(base, selectedMachine, ["plugins"]);
}

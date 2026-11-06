import { t } from "../../i18n.js";
import type { PiPackagesResponse, PiWebConfigResponse, PiWebPluginsResponse } from "../../api";
import { friendlyPiPackageErrorMessage, isPiPackageManagementUnsupported, type PiPackageManagementSupport, type PiPackageTargetContext } from "./piPackageSettings";
import { settingsMachineTargetLabel } from "./settingsMachineTarget";

export interface GatewaySettingsLoaders {
  loadConfig: () => Promise<PiWebConfigResponse>;
  loadPlugins: () => Promise<PiWebPluginsResponse>;
}

export interface GatewaySettingsLoadResult {
  config?: PiWebConfigResponse;
  plugins?: PiWebPluginsResponse;
  failure?: { config?: string; plugins?: string };
  error: string;
}

export interface PiPackagesLoadResult {
  packagesResponse?: PiPackagesResponse;
  failure?: string;
  error: string;
  skipped?: boolean;
}

export async function loadGatewaySettingsData(loaders: GatewaySettingsLoaders): Promise<GatewaySettingsLoadResult> {
  const [config, plugins] = await Promise.allSettled([loaders.loadConfig(), loaders.loadPlugins()]);
  const result: GatewaySettingsLoadResult = { error: "" };
  const errors: string[] = [];

  if (config.status === "fulfilled") result.config = config.value;
  else {
    const diagnostic = errorMessage(config.reason);
    result.failure = { config: diagnostic };
    errors.push(`config: ${diagnostic}`);
  }

  if (plugins.status === "fulfilled") result.plugins = plugins.value;
  else {
    const diagnostic = errorMessage(plugins.reason);
    result.failure = { ...result.failure, plugins: diagnostic };
    errors.push(`PI WEB plugins: ${diagnostic}`);
  }

  if (errors.length > 0) result.error = t("ui.settingsDataLoading.failedToLoadSettings", "Failed to load settings: {join}", { join: errors.join("；") });
  return result;
}

export async function loadPiPackagesData(target: PiPackageTargetContext, loadPackages: (targetId: string) => Promise<PiPackagesResponse>, support?: PiPackageManagementSupport): Promise<PiPackagesLoadResult> {
  if (isPiPackageManagementUnsupported(support)) {
    return { error: support.message ?? t("ui.settingsDataLoading.doesNotSupportPiPackageManagement", "{piPackageTargetLabeltarget} does not support Pi package management.", { piPackageTargetLabeltarget: settingsMachineTargetLabel(target) }), skipped: true };
  }

  try {
    return { packagesResponse: await loadPackages(target.id), error: "" };
  } catch (error) {
    const diagnostic = errorMessage(error);
    return { failure: diagnostic, error: `Failed to load Pi packages from ${settingsMachineTargetLabel(target)}: ${friendlyPiPackageErrorMessage(diagnostic, target)}` };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

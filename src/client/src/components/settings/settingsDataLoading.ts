import { t } from "../../i18n.js";
import type { PiPackagesResponse, PiWebConfigResponse, PiWebPluginsResponse } from "../../api";
import { friendlyPiPackageErrorMessage, isPiPackageManagementUnsupported, piPackageTargetLabel, type PiPackageManagementSupport, type PiPackageTargetContext } from "./piPackageSettings";

export interface GatewaySettingsLoaders {
  loadConfig: () => Promise<PiWebConfigResponse>;
  loadPlugins: () => Promise<PiWebPluginsResponse>;
}

export interface GatewaySettingsLoadResult {
  config?: PiWebConfigResponse;
  plugins?: PiWebPluginsResponse;
  error: string;
}

export interface PiPackagesLoadResult {
  packagesResponse?: PiPackagesResponse;
  error: string;
  skipped?: boolean;
}

export async function loadGatewaySettingsData(loaders: GatewaySettingsLoaders): Promise<GatewaySettingsLoadResult> {
  const [config, plugins] = await Promise.allSettled([loaders.loadConfig(), loaders.loadPlugins()]);
  const result: GatewaySettingsLoadResult = { error: "" };
  const errors: string[] = [];

  if (config.status === "fulfilled") result.config = config.value;
  else errors.push(t("ui.settingsDataLoading.configuration", "Configuration: {reason}", { reason: errorMessage(config.reason) }));

  if (plugins.status === "fulfilled") result.plugins = plugins.value;
  else errors.push(t("ui.settingsDataLoading.piWebPlugins", "PI WEB plugins: {reason}", { reason: errorMessage(plugins.reason) }));

  if (errors.length > 0) result.error = t("ui.settingsDataLoading.failedToLoadSettings", "Failed to load settings: {join}", { join: errors.join("；") });
  return result;
}

export async function loadPiPackagesData(target: PiPackageTargetContext, loadPackages: (targetId: string) => Promise<PiPackagesResponse>, support?: PiPackageManagementSupport): Promise<PiPackagesLoadResult> {
  if (isPiPackageManagementUnsupported(support)) {
    return { error: support.message ?? t("ui.settingsDataLoading.doesNotSupportPiPackageManagement", "{piPackageTargetLabeltarget} does not support Pi package management.", { piPackageTargetLabeltarget: piPackageTargetLabel(target) }), skipped: true };
  }

  try {
    return { packagesResponse: await loadPackages(target.id), error: "" };
  } catch (error) {
    return { error: t("ui.settingsDataLoading.failedToLoadPiPackagesFrom", "Failed to load Pi packages from {piPackageTargetLabeltarget}: {value2}", { piPackageTargetLabeltarget: piPackageTargetLabel(target), value2: friendlyPiPackageErrorMessage(errorMessage(error), target) }) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  else errors.push(`配置：${errorMessage(config.reason)}`);

  if (plugins.status === "fulfilled") result.plugins = plugins.value;
  else errors.push(`PI WEB 插件：${errorMessage(plugins.reason)}`);

  if (errors.length > 0) result.error = `加载设置失败：${errors.join("；")}`;
  return result;
}

export async function loadPiPackagesData(target: PiPackageTargetContext, loadPackages: (targetId: string) => Promise<PiPackagesResponse>, support?: PiPackageManagementSupport): Promise<PiPackagesLoadResult> {
  if (isPiPackageManagementUnsupported(support)) {
    return { error: support.message ?? `${piPackageTargetLabel(target)} 不支持 Pi 包管理。`, skipped: true };
  }

  try {
    return { packagesResponse: await loadPackages(target.id), error: "" };
  } catch (error) {
    return { error: `从 ${piPackageTargetLabel(target)} 加载 Pi 包失败：${friendlyPiPackageErrorMessage(errorMessage(error), target)}` };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

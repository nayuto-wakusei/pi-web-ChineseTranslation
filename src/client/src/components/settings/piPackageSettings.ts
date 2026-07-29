import type { Machine, MachineKind, MachineRuntime, PiPackageInfo, PiPackageMutationAction } from "../../api";
import { PI_WEB_CAPABILITIES, supportsPiWebCapability } from "../../../../shared/capabilities";

export type PiPackageOperationKind = PiPackageMutationAction | "update-all";

export interface PiPackageOperationState {
  kind: PiPackageOperationKind;
  source?: string;
}

export interface PiPackageTargetContext {
  id: string;
  name: string;
  kind: MachineKind;
}

export type PiPackageManagementSupportState = "supported" | "unsupported" | "unknown";

export interface PiPackageManagementSupport {
  state: PiPackageManagementSupportState;
  message?: string;
}

export function piPackageTargetContext(machine: Pick<Machine, "id" | "name" | "kind"> | undefined): PiPackageTargetContext {
  if (machine !== undefined) return { id: machine.id, name: machine.name, kind: machine.kind };
  return { id: "local", name: "local", kind: "local" };
}

export function piPackageTargetLabel(target: PiPackageTargetContext): string {
  return target.kind === "local" ? `${target.name}（本地网关）` : `${target.name}（远程机器）`;
}

export function piPackageManagementSupport(target: PiPackageTargetContext, runtime: Pick<MachineRuntime, "ok" | "capabilities"> | undefined): PiPackageManagementSupport {
  if (target.kind === "local") return { state: "supported" };
  if (runtime?.ok !== true) return { state: "unknown" };
  if (supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.piPackagesManage)) return { state: "supported" };
  return { state: "unsupported", message: piPackageManagementUnavailableMessage(target) };
}

export function piPackageManagementSupportKey(support: PiPackageManagementSupport): string {
  return `${support.state}:${support.message ?? ""}`;
}

export function isPiPackageManagementUnsupported(support: PiPackageManagementSupport | undefined): support is PiPackageManagementSupport & { state: "unsupported" } {
  return support?.state === "unsupported";
}

export function piPackageManagementUnavailableMessage(target: PiPackageTargetContext): string {
  return `${target.name} 不支持 Pi 包管理。请更新并重启该机器上的 PI WEB，然后重试。`;
}

export function shouldRefreshGatewayPluginsAfterPiPackageMutation(target: PiPackageTargetContext): boolean {
  return target.kind === "local";
}

export function normalizePiPackageSource(source: string): string {
  return source.trim();
}

export function piPackageSourceValidationMessage(source: string): string | undefined {
  if (normalizePiPackageSource(source) !== "") return undefined;
  return "请输入 Pi 支持的包来源，例如 npm:@scope/package、Git/URL 来源或本地路径。";
}

export function piPackageScopeLabel(packageInfo: Pick<PiPackageInfo, "scope">): string {
  return packageInfo.scope === "project" ? "项目范围" : "用户范围";
}

export function piPackageFilteredLabel(packageInfo: Pick<PiPackageInfo, "filtered">): string {
  return packageInfo.filtered ? "已被当前 Pi 包设置过滤" : "可用于此 PI WEB 进程";
}

export function piPackageInstalledPathLabel(packageInfo: Pick<PiPackageInfo, "installedPath">): string {
  return packageInfo.installedPath ?? "Pi 未报告安装路径";
}

export function canUpdatePiPackage(packageInfo: Pick<PiPackageInfo, "scope">): boolean {
  return packageInfo.scope === "user";
}

export function piPackageUpdateDisabledReason(packageInfo: Pick<PiPackageInfo, "scope">): string | undefined {
  if (canUpdatePiPackage(packageInfo)) return undefined;
  return "此处会列出项目范围的 Pi 包，但 PI WEB 只能在此界面安全更新用户范围的 Pi 包。";
}

export function canUpdateAllPiPackages(packages: readonly Pick<PiPackageInfo, "scope">[]): boolean {
  return packages.length > 0 && packages.every(canUpdatePiPackage);
}

export function updateAllPiPackagesDisabledReason(packages: readonly Pick<PiPackageInfo, "scope">[]): string | undefined {
  if (packages.length === 0) return "尚未配置 Pi 包。";
  if (canUpdateAllPiPackages(packages)) return undefined;
  return "列表中包含项目范围的 Pi 包，无法全部更新；请逐个更新用户范围的包。";
}

export function isPiPackageOperationPending(operation: PiPackageOperationState | undefined, kind: PiPackageOperationKind, source?: string): boolean {
  if (operation?.kind !== kind) return false;
  return source === undefined || operation.source === source;
}

export function piPackageMutationFollowUpMessage(action: PiPackageMutationAction, target = piPackageTargetContext(undefined)): string {
  const verb = action === "install" ? "已安装" : action === "remove" ? "已移除" : "已更新";
  const targetSuffix = target.kind === "local" ? "" : `（${target.name}）`;
  const sessionScope = target.kind === "local" ? "每个空闲的 PI WEB 会话" : `${target.name} 上每个空闲的 PI WEB 会话`;
  const pluginScope = target.kind === "local" ? "PI WEB 浏览器插件变更" : `${target.name} 提供的 PI WEB 浏览器插件变更`;
  return `Pi 包${verb}${targetSuffix}。请在 ${sessionScope} 中输入 /reload，重新发现 Pi 运行时资源：扩展、技能、提示词模板、主题以及上下文/系统提示文件。对于 ${pluginScope}，请另外重新加载浏览器页面。`;
}

export function friendlyPiPackageErrorMessage(message: string, target: PiPackageTargetContext): string {
  const normalized = message.trim();
  if (target.kind !== "remote") return normalized;
  if (isUnsupportedRemotePiPackageRouteMessage(normalized)) {
    return piPackageManagementUnavailableMessage(target);
  }
  if (normalized === "Remote machine timeout") {
    return `联系 ${target.name} 进行 Pi 包管理时超时。包操作可能仍在远端运行；重试前请重新加载包列表。`;
  }
  if (normalized === "Remote machine unavailable") {
    return `无法连接 ${target.name} 进行 Pi 包管理。请检查机器连接后重试。`;
  }
  return normalized;
}

function isUnsupportedRemotePiPackageRouteMessage(message: string): boolean {
  return message === "Not Found"
    || /route\s+(GET|POST):?\/api\/pi-packages\b.*not found/iu.test(message)
    || /cannot\s+(GET|POST)\s+.*\/api\/pi-packages\b/iu.test(message);
}

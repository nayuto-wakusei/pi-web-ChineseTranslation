import type { Machine, MachineKind, MachineRuntime } from "../../api";

export interface SettingsMachineTarget {
  id: string;
  name: string;
  kind: MachineKind;
}

export type SelectedMachineSettingsSupportState = "supported" | "unsupported" | "unknown";

export interface SelectedMachineSettingsSupport {
  state: SelectedMachineSettingsSupportState;
  message?: string;
}

export type AgentProfileSettingsSupport = SelectedMachineSettingsSupport;

export function settingsMachineTarget(machine: Pick<Machine, "id" | "name" | "kind"> | undefined): SettingsMachineTarget {
  if (machine !== undefined) return { id: machine.id, name: machine.name, kind: machine.kind };
  return { id: "local", name: "本机", kind: "local" };
}

export function settingsMachineTargetLabel(target: SettingsMachineTarget): string {
  return target.kind === "local" ? `${target.name}（本地网关）` : `${target.name}（远程机器）`;
}

export function selectedMachineSettingsSupport(target: SettingsMachineTarget, runtime: Pick<MachineRuntime, "ok" | "capabilities"> | undefined): SelectedMachineSettingsSupport {
  if (target.kind === "local") return { state: "supported" };
  if (runtime?.ok !== true) return { state: "unknown" };
  return { state: "supported" };
}

export function agentProfileSettingsSupport(target: SettingsMachineTarget, runtime: Pick<MachineRuntime, "ok" | "capabilities"> | undefined): AgentProfileSettingsSupport {
  if (target.kind === "local") return { state: "supported" };
  if (runtime?.ok !== true) {
    return {
      state: "unknown",
      message: `无法确认 ${target.name} 是否支持 Pi 兼容代理配置档案。更改配置档案前请重新加载机器状态。`,
    };
  }
  return { state: "supported" };
}

export function selectedMachineSettingsSupportKey(support: SelectedMachineSettingsSupport): string {
  return `${support.state}:${support.message ?? ""}`;
}

export function isSelectedMachineSettingsUnsupported(support: SelectedMachineSettingsSupport | undefined): support is SelectedMachineSettingsSupport & { state: "unsupported" } {
  return support?.state === "unsupported";
}

export function isAgentProfileSettingsSupported(support: AgentProfileSettingsSupport | undefined): boolean {
  return support?.state === "supported";
}

export function selectedMachineSettingsUnavailableMessage(target: SettingsMachineTarget): string {
  return `${target.name} 不支持所选机器设置。请更新并重启该机器上的 PI WEB，然后重试。`;
}

export function friendlySelectedMachineSettingsErrorMessage(message: string, target: SettingsMachineTarget): string {
  const normalized = message.trim();
  if (target.kind !== "remote") return normalized;
  if (isUnsupportedRemoteSelectedMachineSettingsRouteMessage(normalized)) {
    return selectedMachineSettingsUnavailableMessage(target);
  }
  if (normalized === "Remote machine timeout") {
    return `联系 ${target.name} 获取所选机器设置时超时。操作可能仍在远端运行；请重新加载后再重试。`;
  }
  if (normalized === "Remote machine unavailable") {
    return `无法连接 ${target.name} 以获取所选机器设置。请检查机器连接后重试。`;
  }
  return normalized;
}

function isUnsupportedRemoteSelectedMachineSettingsRouteMessage(message: string): boolean {
  return message === "Not Found"
    || /route\s+(GET|PUT):?\/api\/(config|plugins)\b.*not found/iu.test(message)
    || /cannot\s+(GET|PUT)\s+.*\/api\/(config|plugins)\b/iu.test(message);
}

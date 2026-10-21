import { t } from "../../i18n.js";
import type { Machine, MachineKind, MachineRuntime } from "../../api";
import { PI_WEB_CAPABILITIES, supportsPiWebCapability } from "../../../../shared/capabilities";

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
export type PluginLifecycleSupport = SelectedMachineSettingsSupport;

export function pluginLifecycleSupport(target: SettingsMachineTarget, runtime: Pick<MachineRuntime, "ok" | "capabilities"> | undefined): PluginLifecycleSupport {
  if (target.kind === "local") return { state: "supported" };
  if (runtime?.ok !== true) return { state: "unknown" };
  if (supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.pluginLifecycle)) return { state: "supported" };
  return { state: "unsupported", message: pluginLifecycleUnavailableMessage(target) };
}

export function settingsMachineTarget(machine: Pick<Machine, "id" | "name" | "kind"> | undefined): SettingsMachineTarget {
  if (machine !== undefined) return { id: machine.id, name: machine.name, kind: machine.kind };
  return { id: "local", name: t("ui.settingsMachineTarget.local", "Local"), kind: "local" };
}

export function settingsMachineTargetLabel(target: SettingsMachineTarget): string {
  return target.kind === "local" ? t("ui.settingsMachineTarget.localGateway", "{name} (local gateway)", { name: target.name }) : t("ui.settingsMachineTarget.remoteMachine", "{name} (remote machine)", { name: target.name });
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
      message: t("ui.settingsMachineTarget.unableToConfirmWhetherSupportsPiCompatibleAgent", "Unable to confirm whether {name} supports Pi-compatible agent profiles. Reload machine status before changing the profile.", { name: target.name }),
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
  return t("ui.settingsMachineTarget.doesNotSupportSelectedMachineSettingsUpdateAnd", "{name} does not support selected-machine settings. Update and restart PI WEB on that machine, then retry.", { name: target.name });
}

export function pluginLifecycleUnavailableMessage(target: SettingsMachineTarget): string {
  return t("ui.main.a5ae99c3f3cd", "{arg0} does not support plugin lifecycle diagnostics. Update and restart PI WEB on that machine before loading server-dependent plugins.", { arg0: target.name });
}

export function friendlySelectedMachineSettingsErrorMessage(message: string, target: SettingsMachineTarget): string {
  const normalized = message.trim();
  if (target.kind !== "remote") return normalized;
  if (isUnsupportedRemoteSelectedMachineSettingsRouteMessage(normalized)) {
    return selectedMachineSettingsUnavailableMessage(target);
  }
  if (normalized === "Remote machine timeout") {
    return t("ui.settingsMachineTarget.timedOutContactingForSelectedMachineSettingsThe", "Timed out contacting {name} for selected-machine settings. The operation may still be running remotely; reload before retrying.", { name: target.name });
  }
  if (normalized === "Remote machine unavailable") {
    return t("ui.settingsMachineTarget.unableToConnectToForSelectedMachineSettings", "Unable to connect to {name} for selected-machine settings. Check the machine connection and retry.", { name: target.name });
  }
  return normalized;
}

function isUnsupportedRemoteSelectedMachineSettingsRouteMessage(message: string): boolean {
  return message === "Not Found"
    || /route\s+(GET|PUT):?\/api\/(config|plugins)\b.*not found/iu.test(message)
    || /cannot\s+(GET|PUT)\s+.*\/api\/(config|plugins)\b/iu.test(message);
}

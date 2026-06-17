import type { PiWebInstallationInfo, PiWebStatusMessage, PiWebStatusResponse, PluginRuntimeState } from "@chainingintention/pi-web-cn/plugin-api";

export interface CommandEntry {
  label: string;
  command: string;
}

// The single command users should run when they do not want to think: if an
// update is available, `commands.update` already chains the update and a full
// restart; otherwise, when anything is stale, a full restart is enough.
export function recommendedCommand(status: PiWebStatusResponse): CommandEntry | undefined {
  const { commands, release, components } = status;
  if (release.updateAvailable && typeof commands.update === "string" && commands.update !== "") {
    return { label: "更新并重启全部服务", command: commands.update };
  }
  const restartNeeded = components.web.stale || components.sessiond.stale || !components.sessiond.available;
  if (restartNeeded && typeof commands.restart === "string" && commands.restart !== "") {
    return { label: "重启全部服务", command: commands.restart };
  }
  return undefined;
}

export function additionalCommands(status: PiWebStatusResponse, recommended: CommandEntry | undefined): CommandEntry[] {
  return [
    ["更新", status.commands.update],
    ["全部重启", status.commands.restart],
    ["重启 Web/UI", status.commands.restartWeb],
    ["重启会话守护进程", status.commands.restartSessiond],
    ["状态", status.commands.status],
  ]
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "")
    .filter(([, command]) => command !== recommended?.command)
    .map(([label, command]) => ({ label, command }));
}

export function messagesFor(state: PluginRuntimeState | undefined): PiWebStatusMessage[] {
  return state?.piWebStatus?.messages ?? [];
}

export function statusFor(state: PluginRuntimeState | undefined): PiWebStatusResponse | undefined {
  return state?.piWebStatus;
}

export function messageCount(state: PluginRuntimeState | undefined): number {
  return messagesFor(state).length;
}

export function isLocalOrUnknownInstallation(installation: PiWebInstallationInfo | undefined): boolean {
  return installation === undefined || installation.kind === "local" || installation.kind === "unknown";
}

export function shouldShowUpdatesPanel(state: PluginRuntimeState | undefined): boolean {
  const status = statusFor(state);
  if (messageCount(state) > 0) return true;
  if (status === undefined) return false;
  return isLocalOrUnknownInstallation(status.components.web.installation)
    || isLocalOrUnknownInstallation(status.components.sessiond.installation);
}

export function formatVersion(version: string | undefined): string {
  return version === undefined || version === "" ? "未知" : version;
}

export function installationLabel(installation: PiWebInstallationInfo | undefined): string {
  if (installation === undefined) return "安装来源未知";
  if (installation.kind === "pi-package") {
    const scope = installation.scope === undefined ? "" : ` · ${installation.scope}`;
    const source = installation.source ?? "Pi 包";
    return `${source}${scope}`;
  }
  if (installation.kind === "npm-global") return "全局 npm 包";
  if (installation.kind === "local") return "本地 checkout";
  return "安装来源未知";
}

import type { PiWebDockerMode, PiWebInstallationInfo, PiWebStatusMessage, PiWebStatusResponse, PluginRuntimeState } from "@chainingintention/pi-web-cn/plugin-api";

export interface CommandEntry {
  label: string;
  command: string;
}

export interface UpdatesRuntimeHint {
  dockerMode?: PiWebDockerMode;
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

export function isSelfManagedInstallation(installation: PiWebInstallationInfo | undefined): boolean {
  return installation === undefined || installation.kind === "local" || installation.kind === "docker" || installation.kind === "unknown";
}

export function shouldShowUpdatesPanel(state: PluginRuntimeState | undefined, hint: UpdatesRuntimeHint = {}): boolean {
  const status = statusFor(state);
  if (hint.dockerMode !== undefined) return true;
  if (messageCount(state) > 0) return true;
  if (status === undefined) return false;
  return isSelfManagedInstallation(status.components.web.installation)
    || isSelfManagedInstallation(status.components.sessiond.installation);
}

export function fallbackDockerStatus(hint: UpdatesRuntimeHint, generatedAt = "联邦状态不可用"): PiWebStatusResponse | undefined {
  if (hint.dockerMode === undefined) return undefined;
  const commandPrefix = hint.dockerMode === "dev" ? "pi-web-docker --dev" : "pi-web-docker";
  const installation: PiWebInstallationInfo = { kind: "docker", dockerMode: hint.dockerMode };
  return {
    packageName: "@chainingintention/pi-web-cn",
    generatedAt,
    components: {
      web: { component: "web", label: "Web/UI", stale: false, available: true, installation },
      sessiond: { component: "sessiond", label: "Session daemon", stale: false, available: true, installation },
    },
    release: { packageName: "@chainingintention/pi-web-cn", updateAvailable: false, skipped: true },
    commands: {
      update: `${commandPrefix} update`,
      restart: `${commandPrefix} restart`,
      restartWeb: `${commandPrefix} restart-web`,
      restartSessiond: `${commandPrefix} restart-sessiond`,
      status: `${commandPrefix} status`,
    },
    messages: [{
      id: "docker-status-compatibility",
      severity: "info",
      title: "Docker 更新命令可用",
      body: "当前更新插件由 Docker PI WEB 运行时加载，但网关尚未提供 Docker 状态详情。仍可使用下方 Docker 维护命令。",
    }],
  };
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
  if (installation.kind === "docker") return installation.dockerMode === "dev" ? "Docker 开发运行时" : "Docker 运行时";
  return "安装来源未知";
}

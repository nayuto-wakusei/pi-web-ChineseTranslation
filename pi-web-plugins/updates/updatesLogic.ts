import { t } from "./i18n.js";
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
    return { label: t("bundled.updates.update.and.restart.all.services.f469f2", "Update and restart all services"), command: commands.update };
  }
  const restartNeeded = components.web.stale || components.sessiond.stale || !components.sessiond.available;
  if (restartNeeded && typeof commands.restart === "string" && commands.restart !== "") {
    return { label: t("bundled.updates.restart.all.services.f305e3", "Restart all services"), command: commands.restart };
  }
  return undefined;
}

export function additionalCommands(status: PiWebStatusResponse, recommended: CommandEntry | undefined): CommandEntry[] {
  return [
    [t("bundled.updates.updates.3055a0", "Updates"), status.commands.update],
    [t("bundled.updates.restart.all.9dfe69", "Restart all"), status.commands.restart],
    [t("bundled.updates.restart.web.ui.9d6372", "Restart Web/UI"), status.commands.restartWeb],
    [t("bundled.updates.restart.session.daemon.69f455", "Restart session daemon"), status.commands.restartSessiond],
    [t("bundled.updates.status.6320b4", "Status"), status.commands.status],
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

export function fallbackDockerStatus(hint: UpdatesRuntimeHint, generatedAt = t("bundled.updates.federated.status.unavailable.ad4f0b", "Federated status unavailable")): PiWebStatusResponse | undefined {
  if (hint.dockerMode === undefined) return undefined;
  const commandPrefix = hint.dockerMode === "dev" ? "pi-web-docker --dev" : "pi-web-docker";
  const installation: PiWebInstallationInfo = { kind: "docker", dockerMode: hint.dockerMode };
  return {
    packageName: "@chainingintention/pi-web-cn",
    generatedAt,
    components: {
      web: { component: "web", label: t("bundled.updates.web.ui.86d6a2", "Web/UI"), stale: false, available: true, installation },
      sessiond: { component: "sessiond", label: t("bundled.updates.session.daemon.757666", "Session daemon"), stale: false, available: true, installation },
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
      title: t("bundled.updates.docker.update.commands.available.7ab546", "Docker update commands available"),
      body: t("bundled.updates.this.plugin.was.loaded.from.a.docker.pi.web.runtime.but.the.gatew.a4f10a", "This plugin was loaded from a Docker PI WEB runtime, but the gateway has not provided Docker status details yet. The Docker maintenance commands below are still available."),
    }],
  };
}

export function formatVersion(version: string | undefined): string {
  return version === undefined || version === "" ? t("bundled.updates.unknown.4d8c1c", "Unknown") : version;
}

export function installationLabel(installation: PiWebInstallationInfo | undefined): string {
  if (installation === undefined) return t("bundled.updates.unknown.installation.source.22c213", "Unknown installation source");
  if (installation.kind === "pi-package") {
    const scope = installation.scope === undefined ? "" : ` · ${installationScopeLabel(installation.scope)}`;
    const source = installation.source ?? t("bundled.updates.pi.package.feed18", "Pi package");
    return `${source}${scope}`;
  }
  if (installation.kind === "npm-global") return t("bundled.updates.global.npm.package.5e8079", "Global npm package");
  if (installation.kind === "local") return t("bundled.updates.local.checkout.19c28f", "Local checkout");
  if (installation.kind === "docker") return installation.dockerMode === "dev" ? t("bundled.updates.docker.development.runtime.9ba6d5", "Docker development runtime") : t("bundled.updates.docker.runtime.8ce6fc", "Docker runtime");
  return t("bundled.updates.unknown.installation.source.22c213", "Unknown installation source");
}

function installationScopeLabel(scope: "user" | "project"): string {
  return scope === "user" ? t("bundled.updates.user.scope.7baed5", "User scope") : t("bundled.updates.project.scope.0d9798", "Project scope");
}

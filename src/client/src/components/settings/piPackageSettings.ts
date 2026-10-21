import { t } from "../../i18n";
import type { Machine, MachineKind, MachineRuntime, PiPackageInfo, PiPackageMutationAction, PiPackageMutationResponse, PiPackagesResponse } from "../../api";

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
  return { id: "local", name: t("ui.piPackageSettings.local", "Local"), kind: "local" };
}

export function piPackageTargetLabel(target: PiPackageTargetContext): string {
  return target.kind === "local" ? t("ui.settingsMachineTarget.localGateway", "{name} (local gateway)", { name: target.name }) : t("ui.settingsMachineTarget.remoteMachine", "{name} (remote machine)", { name: target.name });
}

export function piPackageManagementSupport(target: PiPackageTargetContext, runtime: Pick<MachineRuntime, "ok" | "capabilities"> | undefined): PiPackageManagementSupport {
  if (target.kind === "local") return { state: "supported" };
  if (runtime?.ok !== true) return { state: "unknown" };
  return { state: "supported" };
}

export function piPackageManagementSupportKey(support: PiPackageManagementSupport): string {
  return `${support.state}:${support.message ?? ""}`;
}

export function isPiPackageManagementUnsupported(support: PiPackageManagementSupport | undefined): support is PiPackageManagementSupport & { state: "unsupported" } {
  return support?.state === "unsupported";
}

export function piPackageManagementUnavailableMessage(target: PiPackageTargetContext): string {
  return t("ui.piPackageSettings.doesNotSupportPiPackageManagementUpdateAnd", "{name} does not support Pi package management. Update and restart PI WEB on that machine, then retry.", { name: target.name });
}

export function shouldRefreshGatewayPluginsAfterPiPackageMutation(target: PiPackageTargetContext): boolean {
  return target.kind === "local";
}

export function normalizePiPackageSource(source: string): string {
  return source.trim();
}

export function piPackageSourceValidationMessage(source: string): string | undefined {
  if (normalizePiPackageSource(source) !== "") return undefined;
  return t("ui.piPackageSettings.enterAPiSupportedPackageSourceSuchAs", "Enter a Pi-supported package source, such as npm:@scope/package, a Git/URL source, or a local path.");
}

export function piPackageScopeLabel(packageInfo: Pick<PiPackageInfo, "scope">): string {
  return packageInfo.scope === "project" ? t("bundled.updates.project.scope.0d9798", "Project scope") : t("bundled.updates.user.scope.7baed5", "User scope");
}

export function piPackageFilteredLabel(packageInfo: Pick<PiPackageInfo, "filtered">): string {
  return packageInfo.filtered ? t("ui.piPackageSettings.filteredByCurrentPiPackageSettings", "Filtered by current Pi package settings") : t("ui.piPackageSettings.availableToThisPiWebProcess", "Available to this PI WEB process");
}

export function piPackageInstalledPathLabel(packageInfo: Pick<PiPackageInfo, "installedPath">): string {
  return packageInfo.installedPath ?? t("ui.piPackageSettings.piDidNotReportAnInstallationPath", "Pi did not report an installation path");
}

/**
 * Carries a mutation response's refreshed package list, and the refreshed
 * installable-known-package suggestions if the server reported any, forward
 * into panel state — so a one-click (re)install or removal updates the
 * "Available packages" suggestions without a separate reload.
 */
export function piPackagesResponseAfterMutation(response: Pick<PiPackageMutationResponse, "packages" | "installableKnownPackages">): PiPackagesResponse {
  return {
    packages: response.packages,
    ...(response.installableKnownPackages === undefined ? {} : { installableKnownPackages: response.installableKnownPackages }),
  };
}

export function canUpdatePiPackage(packageInfo: Pick<PiPackageInfo, "scope">): boolean {
  return packageInfo.scope === "user";
}

export function piPackageUpdateDisabledReason(packageInfo: Pick<PiPackageInfo, "scope">): string | undefined {
  if (canUpdatePiPackage(packageInfo)) return undefined;
  return t("ui.piPackageSettings.projectScopedPiPackagesAreListedHereBut", "Project-scoped Pi packages are listed here, but PI WEB can only safely update user-scoped Pi packages in this interface.");
}

export function canUpdateAllPiPackages(packages: readonly Pick<PiPackageInfo, "scope">[]): boolean {
  return packages.length > 0 && packages.every(canUpdatePiPackage);
}

export function updateAllPiPackagesDisabledReason(packages: readonly Pick<PiPackageInfo, "scope">[]): string | undefined {
  if (packages.length === 0) return t("ui.piPackageSettings.noPiPackagesConfigured", "No Pi packages configured.");
  if (canUpdateAllPiPackages(packages)) return undefined;
  return t("ui.piPackageSettings.theListIncludesProjectScopedPiPackagesSo", "The list includes project-scoped Pi packages, so update-all is unavailable. Update user-scoped packages individually.");
}

export function isPiPackageOperationPending(operation: PiPackageOperationState | undefined, kind: PiPackageOperationKind, source?: string): boolean {
  if (operation?.kind !== kind) return false;
  return source === undefined || operation.source === source;
}

export function piPackageMutationFollowUpMessage(action: PiPackageMutationAction, target = piPackageTargetContext(undefined)): string {
  const verb = action === "install" ? t("ui.piPackageSettings.installed", "installed") : action === "remove" ? t("ui.piPackageSettings.removed", "removed") : t("ui.piPackageSettings.updated", "updated");
  const targetSuffix = target.kind === "local" ? "" : `（${target.name}）`;
  const sessionScope = target.kind === "local" ? t("ui.piPackageSettings.everyIdlePiWebSession", "every idle PI WEB session") : t("ui.piPackageSettings.everyIdlePiWebSessionOn", "every idle PI WEB session on {name}", { name: target.name });
  const pluginScope = target.kind === "local" ? t("ui.piPackageSettings.piWebBrowserPluginChanges", "PI WEB browser plugin changes") : t("ui.piPackageSettings.piWebBrowserPluginChangesFrom", "PI WEB browser plugin changes from {name}", { name: target.name });
  return t("ui.piPackageSettings.piPackageEnterReloadInToRediscoverPi", "Pi package {verb}{targetSuffix}. Enter /reload in {sessionScope} to rediscover Pi runtime resources: extensions, skills, prompt templates, themes, and context/system prompt files. For {pluginScope}, also reload the browser page.", { verb: verb, targetSuffix: targetSuffix, sessionScope: sessionScope, pluginScope: pluginScope });
}

export function friendlyPiPackageErrorMessage(message: string, target: PiPackageTargetContext): string {
  const normalized = message.trim();
  if (target.kind !== "remote") return normalized;
  if (isUnsupportedRemotePiPackageRouteMessage(normalized)) {
    return piPackageManagementUnavailableMessage(target);
  }
  if (normalized === "Remote machine timeout") {
    return t("ui.piPackageSettings.timedOutContactingForPiPackageManagementThe", "Timed out contacting {name} for Pi package management. The operation may still be running remotely; reload the package list before retrying.", { name: target.name });
  }
  if (normalized === "Remote machine unavailable") {
    return t("ui.piPackageSettings.unableToConnectToForPiPackageManagement", "Unable to connect to {name} for Pi package management. Check the machine connection and retry.", { name: target.name });
  }
  return normalized;
}

function isUnsupportedRemotePiPackageRouteMessage(message: string): boolean {
  return message === "Not Found"
    || /route\s+(GET|POST):?\/api\/pi-packages\b.*not found/iu.test(message)
    || /cannot\s+(GET|POST)\s+.*\/api\/pi-packages\b/iu.test(message);
}

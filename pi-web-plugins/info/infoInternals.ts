import { t } from "./i18n.js";
// Implementation details of the bundled Info plugin.
//
// This file is NOT part of the plugin skeleton. If you copied the Info plugin
// as a starting point for your own plugin, replace everything here with your
// own content — the plugin contract (metadata and contribution definitions)
// lives in pi-web-plugin.ts.

import type { TemplateResult } from "lit";
import type { HtmlTemplateTag, MachineKind, PiWebComponentStatus, PiWebInstallationInfo, PiWebReleaseStatus, PiWebStatusResponse, PluginMachine, PluginRuntimeContext, Workspace, WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";

export type ComponentHealth = "current" | "restart needed" | "unavailable";

export function componentHealth(component: PiWebComponentStatus): ComponentHealth {
  if (!component.available) return "unavailable";
  if (component.stale) return "restart needed";
  return "current";
}

function componentHealthLabel(health: ComponentHealth): string {
  if (health === "current") return t("bundled.info.current.837bc9", "Current");
  if (health === "restart needed") return t("bundled.info.restart.needed.1ffd00", "Restart needed");
  return t("bundled.info.unavailable.460b35", "Unavailable");
}

function componentDisplayLabel(component: PiWebComponentStatus): string {
  if (component.component === "web") return t("bundled.info.web.ui.86d6a2", "Web/UI");
  return t("bundled.info.session.daemon.757666", "Session daemon");
}

export function formatVersion(version: string | undefined): string {
  return version === undefined || version === "" ? t("bundled.info.unknown.4d8c1c", "Unknown") : version;
}

export function installationLabel(installation: PiWebInstallationInfo | undefined): string {
  if (installation === undefined) return t("bundled.info.unknown.installation.b61c94", "Unknown installation");
  if (installation.kind === "pi-package") {
    const scope = installation.scope === undefined ? "" : ` · ${installationScopeLabel(installation.scope)}`;
    const source = installation.source ?? t("bundled.info.pi.package.feed18", "Pi package");
    return `${source}${scope}`;
  }
  if (installation.kind === "npm-global") return t("bundled.info.global.npm.package.5e8079", "Global npm package");
  if (installation.kind === "local") return t("bundled.info.local.checkout.19c28f", "Local checkout");
  if (installation.kind === "docker") return installation.dockerMode === "dev" ? t("bundled.info.docker.development.runtime.9ba6d5", "Docker development runtime") : t("bundled.info.docker.runtime.8ce6fc", "Docker runtime");
  return t("bundled.info.unknown.installation.b61c94", "Unknown installation");
}

function installationScopeLabel(scope: "user" | "project"): string {
  return scope === "user" ? t("bundled.info.user.scope.7baed5", "User scope") : t("bundled.info.project.scope.0d9798", "Project scope");
}

export function machineKindLabel(kind: MachineKind): string {
  return kind === "local" ? t("bundled.info.local.machine.ae3fff", "Local machine") : t("bundled.info.remote.machine.674281", "Remote machine");
}

export function releaseSummary(release: PiWebReleaseStatus): string {
  if (release.updateAvailable) {
    return release.latestVersion === undefined || release.latestVersion === ""
      ? t("bundled.info.update.available.5f3ed8", "Update available")
      : t("bundled.info.update.available.6dee04", "Update available: {value1}", { value1: release.latestVersion });
  }
  if (release.error !== undefined && release.error !== "") return t("bundled.info.update.check.failed.b2e600", "Update check failed: {value1}", { value1: release.error });
  if (release.skipped === true) return t("bundled.info.update.check.skipped.966bfb", "Update check skipped");
  return t("bundled.info.up.to.date.bc3104", "Up to date");
}

/** One-line component summary used by the panel rows and the clipboard diagnostics. */
export function componentDetails(component: PiWebComponentStatus): string {
  const parts = [
    t("bundled.info.runtime.09b6b8", "Runtime {value1}", { value1: formatVersion(component.runtimeVersion) }),
    t("bundled.info.installed.a6f713", "Installed {value1}", { value1: formatVersion(component.installedVersion) }),
    componentHealthLabel(componentHealth(component)),
    installationLabel(component.installation),
  ];
  if (component.installation?.path !== undefined && component.installation.path !== "") parts.push(component.installation.path);
  if (component.error !== undefined && component.error !== "") parts.push(t("bundled.info.error.66432a", "Error: {value1}", { value1: component.error }));
  return parts.join(" · ");
}

export function workspaceFlags(workspace: Workspace): string[] {
  return [
    workspace.branch === undefined || workspace.branch === "" ? undefined : t("bundled.info.branch.198c3e", "Branch {value1}", { value1: workspace.branch }),
    workspace.isGitWorktree ? t("bundled.info.git.worktree.c0db6b", "Git worktree") : workspace.isGitRepo ? t("bundled.info.git.repository.6a0dac", "Git repository") : t("bundled.info.non.git.directory.0936b0", "Non-Git directory"),
    workspace.isMain ? t("bundled.info.main.workspace.2ac45d", "Main workspace") : undefined,
  ].filter((flag): flag is string => flag !== undefined);
}

export interface DiagnosticsInput {
  status: PiWebStatusResponse | undefined;
  machine?: PluginMachine | undefined;
  workspace?: Workspace | undefined;
}

/** Plain-text status block suitable for pasting into a bug report. */
export function diagnosticsSummary({ status, machine, workspace }: DiagnosticsInput): string {
  const lines: string[] = [t("bundled.info.pi.web.diagnostics.1e6afe", "PI WEB diagnostics")];
  if (status === undefined) {
    lines.push(t("bundled.info.status.unavailable.e0e66a", "Status: unavailable"));
  } else {
    lines.push(t("bundled.info.package.6efebc", "Package: {value1}", { value1: status.packageName }));
    lines.push(t("bundled.info.component.details", "{component}: {details}", { component: componentDisplayLabel(status.components.web), details: componentDetails(status.components.web) }));
    lines.push(t("bundled.info.component.details", "{component}: {details}", { component: componentDisplayLabel(status.components.sessiond), details: componentDetails(status.components.sessiond) }));
    const checked = status.release.checkedAt === undefined || status.release.skipped === true ? "" : t("bundled.info.checked.at.1ecc98", " (checked at {value1})", { value1: status.release.checkedAt });
    lines.push(t("bundled.info.release.386d3e", "Release: {value1}{value2}", { value1: releaseSummary(status.release), value2: checked }));
    lines.push(t("bundled.info.status.generated.ff5eec", "Status generated: {value1}", { value1: status.generatedAt }));
  }
  if (machine !== undefined) lines.push(t("bundled.info.machine.58d58d", "Machine: {value1} ({value2})", { value1: machine.name, value2: machineKindLabel(machine.kind) }));
  if (workspace === undefined) {
    lines.push(t("bundled.info.workspace.not.selected.a88368", "Workspace: not selected"));
  } else {
    lines.push(t("bundled.info.workspace.fd59a8", "Workspace: {value1} - {value2} ({value3})", { value1: workspace.label, value2: workspace.path, value3: workspaceFlags(workspace).join(t("bundled.info.list.separator", ", ")) }));
  }
  return lines.join("\n");
}

/** Action body: copy the diagnostics summary for the current runtime context. */
export async function copyDiagnostics(context: PluginRuntimeContext): Promise<void> {
  const summary = diagnosticsSummary({
    status: context.state.piWebStatus,
    machine: context.state.selectedMachine,
    workspace: context.state.selectedWorkspace,
  });
  await navigator.clipboard.writeText(summary);
}

function renderComponent(html: HtmlTemplateTag, component: PiWebComponentStatus): TemplateResult {
  const health = componentHealth(component);
  return html`
    <div class="info-component">
      <strong>${componentDisplayLabel(component)}</strong>
      <span class=${health === "current" ? "info-health-ok" : "info-health-attention"}>${componentHealthLabel(health)}</span>
      <small>${componentDetails(component)}</small>
    </div>
  `;
}

function renderStatusSection(html: HtmlTemplateTag, status: PiWebStatusResponse | undefined): TemplateResult {
  if (status === undefined) {
    return html`
      <section>
        <strong>PI WEB</strong>
        <p class="muted">${t("bundled.info.pi.web.status.is.unavailable.it.will.refresh.automatically.381f51", "PI WEB status is unavailable. It will refresh automatically.")}</p>
      </section>
    `;
  }
  const web = status.components.web;
  const messageCount = status.messages.length;
  return html`
    <section>
      <strong>PI WEB</strong>
      <div class="info-row">
        <span>${t("bundled.info.version.5f76b2", "Version")}</span>
        <span>${formatVersion(web.runtimeVersion)}</span>
        ${web.installedVersion === undefined || web.installedVersion === web.runtimeVersion ? null : html`<small>${t("bundled.info.installed.5e7cb6", "Installed {value1}", { value1: formatVersion(web.installedVersion) })}</small>`}
      </div>
      <div class="info-row">
        <span>${t("bundled.info.package.26b9c4", "Package")}</span>
        <span>${status.packageName}</span>
      </div>
      <div class="info-row">
        <span>${t("bundled.info.installation.9c320c", "Installation")}</span>
        <span>${installationLabel(web.installation)}</span>
        ${web.installation?.path === undefined || web.installation.path === "" ? null : html`<small>${web.installation.path}</small>`}
      </div>
      <div class="info-row">
        <span>${t("bundled.info.release.5100f0", "Release")}</span>
        <span>${releaseSummary(status.release)}</span>
        ${status.release.checkedAt === undefined || status.release.skipped === true ? null : html`<small>${t("bundled.info.checked.at.cc4691", "Checked at {value1}", { value1: status.release.checkedAt })}</small>`}
      </div>
      ${messageCount === 0 ? null : html`<p class="muted">${t("bundled.info.status.messages.open.updates.for.details.6ca1fc", "{value1} status messages. Open Updates for details.", { value1: String(messageCount) })}</p>`}
      <p class="muted">${t("bundled.info.status.generated.at.92be3c", "Status generated at {value1}", { value1: status.generatedAt })}</p>
    </section>
    <section>
      <strong>${t("bundled.info.services.ec309a", "Services")}</strong>
      ${renderComponent(html, status.components.web)}
      ${renderComponent(html, status.components.sessiond)}
    </section>
  `;
}

function renderMachineSection(html: HtmlTemplateTag, machine: PluginMachine): TemplateResult {
  return html`
    <section>
      <strong>${t("bundled.info.machine.ece969", "Machine")}</strong>
      <div class="info-row">
        <span>${t("bundled.info.name.d44e9b", "Name")}</span>
        <span>${machine.name}</span>
      </div>
      <div class="info-row">
        <span>${t("bundled.info.type.ba4001", "Type")}</span>
        <span>${machineKindLabel(machine.kind)}</span>
      </div>
    </section>
  `;
}

function renderWorkspaceSection(html: HtmlTemplateTag, workspace: Workspace): TemplateResult {
  return html`
    <section>
      <strong>${t("bundled.info.workspace.379798", "Workspace")}</strong>
      <div class="info-row">
        <span>${t("bundled.info.name.d44e9b", "Name")}</span>
        <span>${workspace.label}</span>
      </div>
      <div class="info-row">
        <span>${t("bundled.info.path.77e1ea", "Path")}</span>
        <span class="info-path">${workspace.path}</span>
        ${workspaceFlags(workspace).length === 0 ? null : html`<small>${workspaceFlags(workspace).join(" · ")}</small>`}
      </div>
    </section>
  `;
}

/** Panel body: render the Info tab for the current workspace panel context. */
export function renderInfoPanel(html: HtmlTemplateTag, context: WorkspacePanelContext): TemplateResult {
  return html`
    <style>
      .viewer.info-status { flex: 1 1 auto; min-height: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; padding: 12px; overflow-y: auto; overflow-x: hidden; }
      .viewer.info-status section { flex: 0 0 auto; min-width: 0; display: grid; gap: 8px; align-content: start; }
      .viewer.info-status p { margin: 0; }
      .info-row { display: grid; grid-template-columns: minmax(90px, auto) minmax(0, 1fr); gap: 3px 10px; border-bottom: 1px solid var(--pi-border-muted); padding: 6px 0; overflow-wrap: anywhere; }
      .info-row small { grid-column: 1 / -1; color: var(--pi-muted); }
      .info-component { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 10px; border-bottom: 1px solid var(--pi-border-muted); padding: 6px 0; }
      .info-component small { grid-column: 1 / -1; color: var(--pi-muted); overflow-wrap: anywhere; }
      .info-health-ok { color: var(--pi-success); }
      .info-health-attention { color: var(--pi-warning); }
    </style>
    <section class="toolbar"><strong>${t("bundled.info.info.e70286", "Info")}</strong></section>
    <section class="viewer info-status">
      ${renderStatusSection(html, context.state?.piWebStatus)}
      ${renderMachineSection(html, context.machine)}
      ${renderWorkspaceSection(html, context.workspace)}
    </section>
  `;
}

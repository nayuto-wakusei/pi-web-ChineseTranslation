// Implementation details of the bundled Info plugin.
//
// This file is NOT part of the plugin skeleton. If you copied the Info plugin
// as a starting point for your own plugin, replace everything here with your
// own content — the plugin contract (metadata and contribution definitions)
// lives in pi-web-plugin.ts.

import type { TemplateResult } from "lit";
import type { ApplicationPanelContext, HtmlTemplateTag, MachineKind, PiWebComponentStatus, PiWebInstallationInfo, PiWebReleaseStatus, PiWebStatusResponse, PluginLocalization, PluginMachine, PluginRuntimeContext, Workspace } from "@chainingintention/pi-web-cn/plugin-api";

import definitions from "./info.messages.js";

export type ComponentHealth = "current" | "restart needed" | "unavailable";

export function componentHealth(component: PiWebComponentStatus): ComponentHealth {
  if (!component.available) return "unavailable";
  if (component.stale) return "restart needed";
  return "current";
}

/** One activation owns the messages; every render reads current regional preferences. */
export function createInfoContent(localization: Pick<PluginLocalization, "registerMessages" | "date" | "list">) {
  const messages = localization.registerMessages("panel", definitions);
  const t = messages.t.bind(messages);
  const timestamp = (value: string): string => localization.date(new Date(value), { dateStyle: "medium", timeStyle: "medium" });
  const serviceName = (component: PiWebComponentStatus): string => t(component.component === "web" ? "web" : "sessiond");
  const healthLabel = (component: PiWebComponentStatus): string => t(!component.available ? "unavailable" : component.stale ? "restartNeeded" : "current");

  function formatVersion(version: string | undefined): string {
    return version === undefined || version === "" ? t("unknown") : version;
  }

  function installationLabel(installation: PiWebInstallationInfo | undefined): string {
    if (installation === undefined) return t("installationUnknown");
    if (installation.kind === "pi-package") {
      const source = installation.source ?? t("piPackage");
      return installation.scope === undefined ? source : t("packageScope", { source, scope: installation.scope });
    }
    if (installation.kind === "npm-global") return t("globalNpm");
    if (installation.kind === "local") return t("localCheckout");
    if (installation.kind === "docker") return t(installation.dockerMode === "dev" ? "dockerDev" : "docker");
    return t("installationUnknown");
  }

  function machineKindLabel(kind: MachineKind): string {
    return t(kind === "local" ? "localMachine" : "remoteMachine");
  }

  function releaseSummary(release: PiWebReleaseStatus): string {
    if (release.updateAvailable) {
      return release.latestVersion === undefined || release.latestVersion === ""
        ? t("updateAvailable")
        : t("updateVersion", { version: release.latestVersion });
    }
    if (release.error !== undefined && release.error !== "") return t("updateFailed", { error: release.error });
    if (release.skipped === true) return t("updateSkipped");
    return t("upToDate");
  }

  /** One-line component summary used by the panel rows and the clipboard diagnostics. */
  function componentDetails(component: PiWebComponentStatus): string {
    let details = t("componentDetails", {
      running: formatVersion(component.runtimeVersion), installed: formatVersion(component.installedVersion),
      pi: formatVersion(component.piVersion), health: healthLabel(component), installation: installationLabel(component.installation),
    });
    if (component.installation?.path !== undefined && component.installation.path !== "") details = t("detailPath", { details, path: component.installation.path });
    if (component.error !== undefined && component.error !== "") details = t("detailError", { details, error: component.error });
    return details;
  }

  /** Note shown when the session daemon runs a different Pi version than the web process. */
  function piVersionDriftNote(web: PiWebComponentStatus, sessiond: PiWebComponentStatus): string | undefined {
    if (!sessiond.available) return undefined;
    if (web.piVersion === undefined || sessiond.piVersion === undefined) return undefined;
    return web.piVersion === sessiond.piVersion ? undefined : t("daemonVersion", { version: formatVersion(sessiond.piVersion) });
  }

  function workspaceFlags(workspace: Workspace): string[] {
    return [
      workspace.provider === undefined ? (workspace.isGitRepo === undefined ? t("folderWorkspace") : undefined) : t("provider", { provider: workspace.provider.pluginId }),
      workspace.branch === undefined ? undefined : t("branch", { branch: workspace.branch }),
      workspace.isGitRepo === undefined ? undefined : t(workspace.isGitRepo ? "gitRepository" : "notGitRepository"),
      workspace.isGitWorktree === true ? t("gitWorktree") : undefined,
      workspace.isMain ? t("mainWorkspace") : undefined,
    ].filter((flag): flag is string => flag !== undefined);
  }

  interface DiagnosticsInput {
    status: PiWebStatusResponse | undefined;
    machine?: PluginMachine | undefined;
    workspace?: Workspace | undefined;
  }

  /** Plain-text status block suitable for pasting into a bug report. */
  function diagnosticsSummary({ status, machine, workspace }: DiagnosticsInput): string {
    const lines: string[] = [t("diagnostics")];
    if (status === undefined) {
      lines.push(t("statusUnavailable"));
    } else {
      lines.push(t("packageLine", { name: status.packageName }));
      for (const component of [status.components.web, status.components.sessiond]) {
        lines.push(t("componentLine", { label: serviceName(component), details: componentDetails(component) }));
      }
      const summary = releaseSummary(status.release);
      lines.push(status.release.checkedAt === undefined || status.release.skipped === true
        ? t("releaseLine", { summary })
        : t("releaseCheckedLine", { summary, date: timestamp(status.release.checkedAt) }));
      lines.push(t("generatedLine", { date: timestamp(status.generatedAt) }));
    }
    if (machine !== undefined) lines.push(t("machineLine", { name: machine.name, kind: machineKindLabel(machine.kind) }));
    if (workspace === undefined) {
      lines.push(t("noWorkspace"));
    } else {
      lines.push(t("workspaceLine", { label: workspace.label, path: workspace.path, flags: localization.list(workspaceFlags(workspace)) }));
    }
    return lines.join("\n");
  }

  /** Action body: copy the diagnostics summary for the current runtime context. */
  async function copyDiagnostics(context: PluginRuntimeContext): Promise<void> {
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
        <strong>${serviceName(component)}</strong>
        <span class=${health === "current" ? "info-health-ok" : "info-health-attention"}>${healthLabel(component)}</span>
        <small>${componentDetails(component)}</small>
      </div>
    `;
  }

  function renderStatusSection(html: HtmlTemplateTag, status: PiWebStatusResponse | undefined): TemplateResult {
    if (status === undefined) {
      return html`
        <section>
          <strong>PI WEB</strong>
          <p class="muted">${t("statusPending")}</p>
        </section>
      `;
    }
    const web = status.components.web;
    const driftNote = piVersionDriftNote(web, status.components.sessiond);
    const messageCount = status.messages.length;
    return html`
      <section>
        <strong>PI WEB</strong>
        <div class="info-row">
          <span>${t("version")}</span>
          <span>${formatVersion(web.runtimeVersion)}</span>
          ${web.installedVersion === undefined || web.installedVersion === web.runtimeVersion ? null : html`<small>${t("installedVersion", { version: formatVersion(web.installedVersion) })}</small>`}
        </div>
        <div class="info-row">
          <span>Pi</span>
          <span>${formatVersion(web.piVersion)}</span>
          ${driftNote === undefined ? null : html`<small>${driftNote}</small>`}
        </div>
        <div class="info-row">
          <span>${t("package")}</span>
          <span>${status.packageName}</span>
        </div>
        <div class="info-row">
          <span>${t("installation")}</span>
          <span>${installationLabel(web.installation)}</span>
          ${web.installation?.path === undefined || web.installation.path === "" ? null : html`<small>${web.installation.path}</small>`}
        </div>
        <div class="info-row">
          <span>${t("release")}</span>
          <span>${releaseSummary(status.release)}</span>
          ${status.release.checkedAt === undefined || status.release.skipped === true ? null : html`<small>${t("checked", { date: timestamp(status.release.checkedAt) })}</small>`}
        </div>
        ${messageCount === 0 ? null : html`<p class="muted">${t("statusMessages", { count: messageCount })}</p>`}
        <p class="muted">${t("statusGenerated", { date: timestamp(status.generatedAt) })}</p>
      </section>
      <section>
        <strong>${t("services")}</strong>
        ${renderComponent(html, status.components.web)}
        ${renderComponent(html, status.components.sessiond)}
      </section>
    `;
  }

  function renderMachineSection(html: HtmlTemplateTag, machine: PluginMachine): TemplateResult {
    return html`
      <section>
        <strong>${t("machine")}</strong>
        <div class="info-row">
          <span>${t("name")}</span>
          <span>${machine.name}</span>
        </div>
        <div class="info-row">
          <span>${t("type")}</span>
          <span>${machineKindLabel(machine.kind)}</span>
        </div>
      </section>
    `;
  }

  function renderWorkspaceSection(html: HtmlTemplateTag, workspace: Workspace): TemplateResult {
    return html`
      <section>
        <strong>${t("workspace")}</strong>
        <div class="info-row">
          <span>${t("name")}</span>
          <span>${workspace.label}</span>
        </div>
        <div class="info-row">
          <span>${t("path")}</span>
          <span class="info-path">${workspace.path}</span>
          ${workspaceFlags(workspace).length === 0 ? null : html`<small>${localization.list(workspaceFlags(workspace))}</small>`}
        </div>
      </section>
    `;
  }

  /** Panel body: machine status is useful even without a selected workspace. */
  function renderInfoPanel(html: HtmlTemplateTag, context: ApplicationPanelContext): TemplateResult {
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
      <section class="toolbar"><strong>${t("info")}</strong></section>
      <section class="viewer info-status">
        ${renderStatusSection(html, context.state.piWebStatus)}
        ${renderMachineSection(html, context.machine)}
        ${context.workspace === undefined ? null : renderWorkspaceSection(html, context.workspace)}
      </section>
    `;
  }

  return { messages, formatVersion, installationLabel, machineKindLabel, releaseSummary, componentDetails, piVersionDriftNote, workspaceFlags, diagnosticsSummary, copyDiagnostics, renderInfoPanel };
}

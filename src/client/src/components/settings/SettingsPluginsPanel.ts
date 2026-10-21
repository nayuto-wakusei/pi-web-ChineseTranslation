import { t } from "../../i18n";
import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PiWebConfigResponse, PiWebPluginInfo, PiWebPluginsResponse } from "../../api";
import { PI_WEB_PLUGIN_RECOVERY_COMMANDS } from "../../../../shared/pluginRecoveryCommands";
import { REQUIRED_TERMINAL_PLUGIN_ID } from "../../../../shared/requiredTerminalPlugin";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";

export type SettingsPluginRow = PiWebPluginInfo & { configOnly: boolean; editable: boolean };

@customElement("settings-plugins-panel")
export class SettingsPluginsPanel extends LitElement {
  @property({ attribute: false }) pluginsResponse: PiWebPluginsResponse | undefined;
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property({ type: Boolean }) recoveryCommandsSupported = false;
  @property() error = "";
  @property() savedMessage = "";
  @property() targetLabel = t("ui.settingsSessiondPanel.localLocalGateway", "Local (local gateway)");
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onTogglePlugin?: (pluginId: string, enabled: boolean) => void | Promise<void>;

  override render(): TemplateResult {
    const plugins = settingsPluginRows(this.pluginsResponse, this.configResponse);
    const hasPluginResponse = this.pluginsResponse !== undefined;
    return html`
      <settings-panel-frame
        heading="${t("client.machinePluginLoadCoordinator.pi.web.plugins.54b78f", "PI WEB plugins")}"
        .description=${pluginsDescription(this.targetLabel)}
        actionLabel="${t("ui.settingsPackagesPanel.reload", "Reload")}"
        actionTitle=${t("ui.settingsPluginsPanel.reloadPiWebPluginsFrom", "Reload PI WEB plugins from {targetLabel}", { targetLabel: this.targetLabel })}
        .actionDisabled=${this.loading}
        .notices=${this.panelNotices(plugins.length > 0)}
        .onAction=${this.onReload}
      >
        ${this.renderPanelContent(plugins, hasPluginResponse)}
      </settings-panel-frame>
    `;
  }

  private panelNotices(showTrustedCodeWarning: boolean): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    if (this.error !== "") notices.push({ type: "error", content: this.error });
    if (this.shouldShowConfigUnavailableNotice(showTrustedCodeWarning)) {
      notices.push({ type: "availability", content: t("ui.settingsPluginsPanel.configurationUnavailableReloadBeforeChangingPluginActivation", "Configuration unavailable. Reload before changing plugin activation.") });
    }
    if (this.savedMessage !== "") notices.push({ type: "success", content: this.savedNotice() });

    const runtime = this.pluginsResponse?.serverRuntime;
    if (runtime?.status === "unavailable") {
      notices.push({
        type: "availability",
        title: t("ui.main.a82125df2e73", "Active server-plugin state unavailable"),
        content: html`${t("ui.main.6287fc62588d", "Desired config remains editable, but PI WEB cannot verify the sessiond snapshot. ")}${runtime.message ?? t("ui.main.2cf299cf47cb", "Restart or reconnect sessiond, then reload.")}`,
      });
    } else if (runtime?.status === "incompatible") {
      notices.push({
        type: "error",
        title: t("ui.main.712114e46934", "Plugin lifecycle version mismatch"),
        content: html`${runtime.message ?? t("ui.main.9b21bc233c7c", "The web process and session daemon do not support the same plugin lifecycle protocol.")}${t("ui.main.b080e2709663", " Update and restart both components before loading server-backed browser plugins.")}`,
      });
    }
    if (runtime?.safeStart !== undefined) {
      notices.push({
        type: "warning",
        title: t("ui.main.0a4319cf8398", "Server-plugin safe mode active"),
        content: runtime.safeStart === "bundled-only"
          ? html`${t("ui.main.b9dae93a22c0", "Only bundled server plugins were imported. Clear safe mode with")} <code>${runtime.recovery.clearSafeStart}</code>.`
          : html`${t("ui.main.66b054df2b58", "No server plugins were imported; Terminal is unavailable and the kernel folder workspace remains available for diagnosis. Clear safe mode with")} <code>${runtime.recovery.clearSafeStart}</code>.`,
      });
    }
    if (runtime?.desiredSafeStart !== undefined && runtime.desiredSafeStart !== (runtime.safeStart ?? "off")) {
      notices.push({
        type: "warning",
        title: t("ui.main.298ed29158e3", "Safe-mode restart pending"),
        content: runtime.desiredSafeStart === "off"
          ? t("ui.main.49a77159c6e3", "Safe start is cleared in offline config but remains active until sessiond restarts.")
          : t("ui.main.d2ac58b29d16", "Offline configuration requests safe-start mode {arg0}; it takes effect before plugin imports on the next sessiond restart.", { arg0: runtime.desiredSafeStart }),
      });
    }
    if (runtime?.restartRequired === true) {
      notices.push({
        type: "warning",
        title: t("ui.main.612b234166d8", "Session-daemon restart required"),
        content: t("ui.main.484f6a3d0361", "Desired plugin config or package revisions differ from sessiond's active startup snapshot. Restarting sessiond may interrupt active sessions."),
      });
    }
    for (const diagnostic of this.pluginsResponse?.diagnostics ?? []) {
      notices.push({
        type: diagnostic.kind === "conflict" ? "error" : "warning",
        title: diagnostic.kind === "conflict" ? t("ui.main.609dbc2f0e1d", "Plugin id conflict") : t("ui.main.35e12ff16006", "Plugin discovery diagnostic"),
        content: `${diagnostic.snapshot === "active" ? t("ui.main.54f92b108f4c", "Active snapshot") : t("ui.main.7431e6af59cf", "Desired catalog")}: ${diagnostic.message}`,
      });
    }
    if (showTrustedCodeWarning) {
      notices.push({
        type: "security",
        content: html`<strong>${t("ui.settingsPackagesPanel.trustedCodeWarning", "Trusted code warning:")}</strong>${t("ui.settingsPluginsPanel.piWebPluginsAndPiPackagesCanRun", "PI WEB plugins and Pi packages can run with your user permissions. Only enable plugins from trusted sources.")}`,
      });
    }
    return notices;
  }

  private savedNotice(): string {
    if (this.pluginsResponse?.serverRuntime.status !== "available" || this.pluginsResponse.serverRuntime.restartRequired) {
      return t("ui.main.2e4750a31e03", "{arg0} Restart the session daemon to apply server plugin changes; browser-only changes take effect after reloading this tab.", { arg0: this.savedMessage });
    }
    return t("ui.main.ccf27b0f4ff9", "{arg0} Reload the browser tab to apply browser-only plugin changes.", { arg0: this.savedMessage });
  }

  private shouldShowConfigUnavailableNotice(hasLoadedPlugins: boolean): boolean {
    return hasLoadedPlugins && this.configResponse === undefined && !this.loading && this.error === "";
  }

  private renderPanelContent(plugins: SettingsPluginRow[], hasPluginResponse: boolean): TemplateResult {
    if (!hasPluginResponse && plugins.length === 0) {
      return html`
        <div class="loading-card">${this.loading ? t("ui.settingsPluginsPanel.loadingPiWebPlugins", "Loading PI WEB plugins…") : t("ui.settingsPluginsPanel.piWebPluginListForIsUnavailableReload", "PI WEB plugin list for {targetLabel} is unavailable. Reload.", { targetLabel: this.targetLabel })}</div>
        ${this.renderRecoveryCommands()}
      `;
    }
    if (plugins.length === 0) {
      return html`
        <div class="loading-card">${t("ui.main.686b703f41f3", "No PI WEB plugins are discovered or active on")} ${this.targetLabel} ${t("ui.main.b7ad7cf69387", ".")}</div>
        ${this.renderRecoveryCommands()}
      `;
    }
    return html`
      <div class="plugin-note">${this.targetLabel} ${t("ui.main.2432ea1a4c8b", ":")} <code>plugins</code>${t("ui.main.8ccf013eb3c2", ". Browser-only changes apply after a tab reload; server-backed changes follow sessiond's startup snapshot and can require a manual restart.")}</div>
      <div class="plugin-list">
        ${plugins.map((plugin) => this.renderPlugin(plugin))}
      </div>
      ${this.renderRecoveryCommands()}
    `;
  }

  private renderPlugin(plugin: SettingsPluginRow): TemplateResult {
    const configured = this.configResponse?.config.plugins?.[plugin.id];
    const configuredState = plugin.required === true
      ? t("ui.main.fb76852a3fdc", "Required · ordinary config cannot disable")
      : !plugin.discovered && configured === undefined
        ? t("ui.main.ccf65fb6a4e5", "Desired package/config absent")
        : configured?.enabled === false ? t("ui.settingsPluginsPanel.disabledByConfiguration", "Disabled by configuration") : configured?.enabled === true ? t("ui.settingsPluginsPanel.enabledByConfiguration", "Enabled by configuration") : t("ui.settingsPluginsPanel.enabledByDefault", "Enabled by default");
    return html`
      <article class=${`plugin-card${plugin.enabled ? "" : " disabled"}`}>
        <div class="plugin-main">
          <strong>${plugin.id}</strong>
          <small>${plugin.configOnly ? t("ui.main.40098da54072", "configured only · package not discovered") : `${pluginSourceLabel(plugin.source)} · ${pluginScopeLabel(plugin.scope)}${plugin.machineSpecific ? t("ui.settingsPluginsPanel.machineSpecific", " · Machine-specific") : ""}${plugin.required === true ? t("ui.main.5ce75af5c91a", " · required") : ""}${plugin.discovered ? "" : t("ui.main.b00e20aa7b93", " · active snapshot only")}`}</small>
          <small>${configuredState}</small>
          ${this.renderPluginStatuses(plugin)}
          ${plugin.server?.message === undefined ? nothing : html`<small class="diagnostic">${plugin.server.message}</small>`}
          ${plugin.server?.health?.message === undefined ? nothing : html`<small class="diagnostic">${t("ui.main.cfa349711e67", "Health:")}${plugin.server.health.message}</small>`}
          ${plugin.server === undefined || plugin.required === true ? nothing : html`<small class="command">${t("ui.main.c54bd03f1522", "Offline disable:")} <code>${plugin.server.disableCommand}</code></small>`}
        </div>
        <label class="toggle">
          <input type="checkbox" .checked=${plugin.enabled} ?disabled=${this.saving || this.configResponse === undefined || !plugin.editable} @change=${(event: Event) => { void this.togglePlugin(plugin, event); }}>
          <span>${plugin.required === true ? t("ui.main.12ea99f8d0b5", "Required") : t("ui.settingsSessiondPanel.enabled", "Enabled")}</span>
        </label>
      </article>
    `;
  }

  private renderPluginStatuses(plugin: SettingsPluginRow): TemplateResult {
    const server = plugin.server;
    return html`
      <div class="status-list" aria-label=${t("ui.main.062b4cb6a584", "{arg0} plugin status", { arg0: plugin.id })}>
        ${server === undefined ? html`<span class="status neutral">${plugin.configOnly ? t("ui.main.886efbba295e", "Configured only") : t("ui.main.a36380d21dcd", "Browser only")}</span>` : html`<span class=${`status ${serverStateTone(server.state)}`}>${serverStateLabel(server.state)}</span>`}
        ${plugin.conflict ? html`<span class="status error">${t("ui.main.dc60132944dd", "Conflict")}</span>` : nothing}
        ${server?.staleRevision === true ? html`<span class="status warning">${t("ui.main.4e68d6d5c959", "Stale revision")}</span>` : nothing}
        ${server?.restartRequired === true ? html`<span class="status warning">${t("bundled.info.restart.needed.1ffd00", "Restart needed")}</span>` : nothing}
        ${server?.health === undefined ? nothing : html`<span class=${`status ${healthTone(server.health.status)}`}>${t("ui.main.2e604c06f096", "Health")} ${healthLabel(server.health.status)}</span>`}
      </div>
    `;
  }

  private renderRecoveryCommands(): TemplateResult | typeof nothing {
    const runtime = this.pluginsResponse?.serverRuntime;
    const responseRecovery = runtime?.status === "incompatible" && !this.recoveryCommandsSupported ? undefined : runtime?.recovery;
    const recovery = responseRecovery ?? (this.recoveryCommandsSupported ? PI_WEB_PLUGIN_RECOVERY_COMMANDS : undefined);
    if (recovery === undefined) return nothing;
    return html`
      <aside class="recovery" aria-label="${t("ui.main.a444df361594", "Offline server-plugin recovery commands")}">
        <strong>${this.targetLabel} ${t("ui.main.ca56f3ca43d1", " offline recovery")}</strong>
        <small>${t("ui.main.277115ec7cae", "These commands edit config without contacting sessiond or importing plugins. They never include machine credentials.")}</small>
        <code>${recovery.showSafeStart}</code>
        <code>${recovery.bundledOnly}</code>
        <code>${recovery.noServerPlugins}</code>
        <code>${recovery.clearSafeStart}</code>
      </aside>
    `;
  }

  private async togglePlugin(plugin: SettingsPluginRow, event: Event): Promise<void> {
    if (!plugin.editable || plugin.required === true || plugin.id === REQUIRED_TERMINAL_PLUGIN_ID) return;
    const enabled = event.target instanceof HTMLInputElement ? event.target.checked : plugin.enabled;
    await this.onTogglePlugin?.(plugin.id, enabled);
  }

  static override styles = css`
    :host { display: block; }
    input { font: inherit; }
    input:disabled { opacity: .55; cursor: not-allowed; }
    .loading-card, .plugin-note, .plugin-card, .recovery { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .loading-card, .plugin-note { color: var(--pi-muted); }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .plugin-list { display: grid; gap: 10px; }
    .plugin-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
    .plugin-card.disabled { opacity: .8; }
    .plugin-main { min-width: 0; display: grid; gap: 5px; }
    .plugin-main > strong, .plugin-main > small:not(.command) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .plugin-main small { color: var(--pi-muted); }
    .diagnostic { color: var(--pi-text) !important; }
    .command { line-height: 1.5; }
    .status-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 2px; }
    .status { border: 1px solid var(--pi-border-muted); border-radius: 999px; padding: 2px 7px; color: var(--pi-muted); font-size: 11px; line-height: 1.3; }
    .status.success { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-surface); }
    .status.warning { border-color: var(--pi-warning-border); color: var(--pi-text); background: var(--pi-warning-surface); }
    .status.error { border-color: var(--pi-danger); color: var(--pi-danger); }
    .toggle { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
    .toggle input { width: 18px; height: 18px; accent-color: var(--pi-accent); }
    .recovery { display: grid; gap: 7px; }
    .recovery small { color: var(--pi-muted); line-height: 1.4; }
    .recovery code { display: block; width: fit-content; max-width: 100%; }

    @media (max-width: 760px) {
      .plugin-card { grid-template-columns: minmax(0, 1fr); align-items: start; }
      .toggle { justify-self: start; }
    }
  `;
}

export function settingsPluginRows(
  response: PiWebPluginsResponse | undefined,
  config: PiWebConfigResponse | undefined,
): SettingsPluginRow[] {
  const configuredPlugins = config?.config.plugins ?? {};
  const rows = (response?.plugins ?? []).map((plugin): SettingsPluginRow => {
    const configured = configuredPlugins[plugin.id];
    const enabled = plugin.required === true ? true : configured?.enabled ?? plugin.enabled;
    return {
      ...plugin,
      enabled,
      configOnly: false,
      editable: plugin.required !== true && (plugin.discovered || configured !== undefined),
    };
  });
  const knownIds = new Set(rows.map(({ id }) => id));
  for (const [id, configured] of Object.entries(configuredPlugins)) {
    if (knownIds.has(id)) continue;
    const required = id === REQUIRED_TERMINAL_PLUGIN_ID;
    rows.push({
      id,
      ...(required ? { required: true as const } : {}),
      source: "config",
      scope: "local",
      machineSpecific: false,
      enabled: required || configured.enabled !== false,
      discovered: false,
      conflict: false,
      configOnly: true,
      editable: !required,
    });
  }
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

function serverStateLabel(state: NonNullable<PiWebPluginInfo["server"]>["state"]): string {
  switch (state) {
    case "active": return t("ui.main.b1eea7b855e6", "Active");
    case "failed": return t("ui.toolExecutionView.failed", "Failed");
    case "incompatible": return t("ui.main.8d1f2155372e", "Incompatible");
    case "disabled": return t("ui.settingsShortcutsPanel.disabled", "Disabled");
    case "missing": return t("ui.main.f1ebc7eeb432", "Not active");
    case "unknown": return t("ui.main.36946f6e6dec", "Active state unavailable");
  }
}

function serverStateTone(state: NonNullable<PiWebPluginInfo["server"]>["state"]): "success" | "warning" | "error" | "neutral" {
  switch (state) {
    case "active": return "success";
    case "disabled":
    case "missing": return "warning";
    case "failed":
    case "incompatible": return "error";
    case "unknown": return "neutral";
  }
}

function healthTone(status: NonNullable<NonNullable<PiWebPluginInfo["server"]>["health"]>["status"]): "success" | "warning" | "error" {
  switch (status) {
    case "healthy": return "success";
    case "degraded": return "warning";
    case "unhealthy": return "error";
  }
}

function pluginsDescription(targetLabel: string): TemplateResult {
  return html`${t("ui.main.4bc9cf7ff997", "Compare desired plugin config with the active sessiond startup snapshot on")} <strong>${targetLabel}</strong>${t("ui.main.9c96947ff33e", ". This is separate from installing Pi packages.")}`;
}

function pluginSourceLabel(source: string): string {
  if (source === "bundled") return t("ui.settingsPluginsPanel.bundled", "Bundled");
  if (source === "local") return t("ui.settingsPluginsPanel.local", "Local");
  if (source === "dev") return t("ui.settingsPluginsPanel.development", "Development");
  return source;
}
function pluginScopeLabel(scope: PiWebPluginInfo["scope"]): string {
  switch (scope) {
    case "bundled": return t("ui.settingsPluginsPanel.bundledScope", "Bundled scope");
    case "local": return t("ui.settingsPluginsPanel.localScope", "Local scope");
    case "user": return t("ui.settingsPluginsPanel.userScope", "User scope");
    case "project": return t("ui.settingsPluginsPanel.projectScope", "Project scope");
  }
}
function healthLabel(status: NonNullable<NonNullable<PiWebPluginInfo["server"]>["health"]>["status"]): string {
  switch (status) {
    case "healthy": return t("ui.main.f78d037abccd", "Healthy");
    case "degraded": return t("ui.main.d8518883839d", "Degraded");
    case "unhealthy": return t("ui.main.5caf27933926", "Unhealthy");
  }
}

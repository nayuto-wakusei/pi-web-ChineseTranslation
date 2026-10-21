import { t } from "../../i18n.js";
import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PiWebConfigResponse, PiWebPluginInfo, PiWebPluginsResponse } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";

@customElement("settings-plugins-panel")
export class SettingsPluginsPanel extends LitElement {
  @property({ attribute: false }) pluginsResponse: PiWebPluginsResponse | undefined;
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property() targetLabel = t("ui.settingsPluginsPanel.localLocalGateway", "Local (local gateway)");
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onTogglePlugin?: (pluginId: string, enabled: boolean) => void | Promise<void>;

  override render(): TemplateResult {
    const plugins = this.pluginsResponse?.plugins ?? [];
    const hasPluginResponse = this.pluginsResponse !== undefined;
    return html`
      <settings-panel-frame
        heading=${t("ui.settingsPluginsPanel.piWebPlugins", "PI WEB plugins")}
        .description=${pluginsDescription(this.targetLabel)}
        actionLabel=${t("ui.settingsPluginsPanel.reload", "Reload")}
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
    if (this.savedMessage !== "") notices.push({ type: "success", content: t("ui.settingsPluginsPanel.reloadTheBrowserTabToApplyPluginChanges", "{savedMessage} Reload the browser tab to apply plugin changes.", { savedMessage: this.savedMessage }) });
    if (showTrustedCodeWarning) {
      notices.push({
        type: "security",
        content: html`<strong>${t("ui.settingsPluginsPanel.trustedCodeWarning", "Trusted code warning:")}</strong>${t("ui.settingsPluginsPanel.piWebPluginsAndPiPackagesCanRun", "PI WEB plugins and Pi packages can run with your user permissions. Only enable plugins from trusted sources.")}`,
      });
    }
    return notices;
  }

  private shouldShowConfigUnavailableNotice(hasLoadedPlugins: boolean): boolean {
    return hasLoadedPlugins && this.configResponse === undefined && !this.loading && this.error === "";
  }

  private renderPanelContent(plugins: PiWebPluginInfo[], hasPluginResponse: boolean): TemplateResult {
    if (!hasPluginResponse) {
      return html`<div class="loading-card">${this.loading ? t("ui.settingsPluginsPanel.loadingPiWebPlugins", "Loading PI WEB plugins…") : t("ui.settingsPluginsPanel.piWebPluginListForIsUnavailableReload", "PI WEB plugin list for {targetLabel} is unavailable. Reload.", { targetLabel: this.targetLabel })}</div>`;
    }
    if (plugins.length === 0) {
      return html`<div class="loading-card">${t("ui.settingsPluginsPanel.noPlugins", "No PI WEB browser plugins were found on {machine}.", { machine: this.targetLabel })}</div>`;
    }
    return html`
      <div class="plugin-note">${t("ui.settingsPluginsPanel.configurationHint", "Configuration key on {machine}: plugins. Plugins are enabled by default unless an entry sets enabled to false.", { machine: this.targetLabel })}</div>
      <div class="plugin-list">
        ${plugins.map((plugin) => this.renderPlugin(plugin))}
      </div>
    `;
  }

  private renderPlugin(plugin: PiWebPluginInfo): TemplateResult {
    const configured = this.configResponse?.config.plugins?.[plugin.id];
    const configuredState = configured?.enabled === false ? t("ui.settingsPluginsPanel.disabledByConfiguration", "Disabled by configuration") : configured?.enabled === true ? t("ui.settingsPluginsPanel.enabledByConfiguration", "Enabled by configuration") : t("ui.settingsPluginsPanel.enabledByDefault", "Enabled by default");
    return html`
      <article class=${`plugin-card${plugin.enabled ? "" : " disabled"}`}>
        <div class="plugin-main">
          <strong>${plugin.id}</strong>
          <small>${pluginSourceLabel(plugin.source)} · ${pluginScopeLabel(plugin.scope)}${plugin.machineSpecific ? t("ui.settingsPluginsPanel.machineSpecific", " · Machine-specific") : ""}</small>
          <small>${configuredState}</small>
        </div>
        <label class="toggle">
          <input type="checkbox" .checked=${plugin.enabled} ?disabled=${this.saving || this.configResponse === undefined} @change=${(event: Event) => { void this.togglePlugin(plugin, event); }}>
          <span>${plugin.enabled ? t("ui.settingsPluginsPanel.enabled", "Enabled") : t("ui.settingsPluginsPanel.disabled", "Disabled")}</span>
        </label>
      </article>
    `;
  }

  private async togglePlugin(plugin: PiWebPluginInfo, event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement ? event.target.checked : plugin.enabled;
    await this.onTogglePlugin?.(plugin.id, enabled);
  }

  static override styles = css`
    :host { display: block; }
    input { font: inherit; }
    input:disabled { opacity: .55; cursor: not-allowed; }
    .loading-card, .plugin-note, .plugin-card { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .loading-card, .plugin-note { color: var(--pi-muted); }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .plugin-list { display: grid; gap: 10px; }
    .plugin-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
    .plugin-card.disabled { opacity: .75; }
    .plugin-main { min-width: 0; display: grid; gap: 3px; }
    .plugin-main strong, .plugin-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .plugin-main small { color: var(--pi-muted); }
    .toggle { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
    .toggle input { width: 18px; height: 18px; accent-color: var(--pi-accent); }

    @media (max-width: 760px) {
      .plugin-card { grid-template-columns: minmax(0, 1fr); align-items: start; }
      .toggle { justify-self: start; }
    }
  `;
}

function pluginsDescription(targetLabel: string): TemplateResult {
  return html`${t("ui.settingsPluginsPanel.enableOrDisable", "Enable or disable ")} <strong>${targetLabel}</strong> ${t("ui.settingsPluginsPanel.piWebBrowserPluginsThisIsIndependentOf", " PI WEB browser plugins. This is independent of installing Pi packages; reload the browser tab to apply plugin runtime changes.")}`;
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

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
  @property() targetLabel = "本机（本地网关）";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onTogglePlugin?: (pluginId: string, enabled: boolean) => void | Promise<void>;

  override render(): TemplateResult {
    const plugins = this.pluginsResponse?.plugins ?? [];
    const hasPluginResponse = this.pluginsResponse !== undefined;
    return html`
      <settings-panel-frame
        heading="PI WEB 插件"
        .description=${pluginsDescription(this.targetLabel)}
        actionLabel="重新加载"
        actionTitle=${`从 ${this.targetLabel} 重新加载 PI WEB 插件`}
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
      notices.push({ type: "availability", content: "配置不可用。更改插件启用状态前请重新加载。" });
    }
    if (this.savedMessage !== "") notices.push({ type: "success", content: `${this.savedMessage} 重新加载浏览器标签页以应用插件更改。` });
    if (showTrustedCodeWarning) {
      notices.push({
        type: "security",
        content: html`<strong>受信代码警告：</strong>PI WEB 插件和 Pi 包可使用你的用户权限运行。请仅启用可信来源的插件。`,
      });
    }
    return notices;
  }

  private shouldShowConfigUnavailableNotice(hasLoadedPlugins: boolean): boolean {
    return hasLoadedPlugins && this.configResponse === undefined && !this.loading && this.error === "";
  }

  private renderPanelContent(plugins: PiWebPluginInfo[], hasPluginResponse: boolean): TemplateResult {
    if (!hasPluginResponse) {
      return html`<div class="loading-card">${this.loading ? "正在加载 PI WEB 插件…" : `${this.targetLabel} 的 PI WEB 插件列表不可用，请重新加载。`}</div>`;
    }
    if (plugins.length === 0) {
      return html`<div class="loading-card">在 ${this.targetLabel} 上未发现 PI WEB 浏览器插件。</div>`;
    }
    return html`
      <div class="plugin-note">${this.targetLabel} 上的配置键：<code>plugins</code>。除非条目将 <code>enabled</code> 设为 <code>false</code>，插件默认启用。</div>
      <div class="plugin-list">
        ${plugins.map((plugin) => this.renderPlugin(plugin))}
      </div>
    `;
  }

  private renderPlugin(plugin: PiWebPluginInfo): TemplateResult {
    const configured = this.configResponse?.config.plugins?.[plugin.id];
    const configuredState = configured?.enabled === false ? "配置已禁用" : configured?.enabled === true ? "配置已启用" : "默认启用";
    return html`
      <article class=${`plugin-card${plugin.enabled ? "" : " disabled"}`}>
        <div class="plugin-main">
          <strong>${plugin.id}</strong>
          <small>${pluginSourceLabel(plugin.source)} · ${pluginScopeLabel(plugin.scope)}${plugin.machineSpecific ? " · 机器专属" : ""}</small>
          <small>${configuredState}</small>
        </div>
        <label class="toggle">
          <input type="checkbox" .checked=${plugin.enabled} ?disabled=${this.saving || this.configResponse === undefined} @change=${(event: Event) => { void this.togglePlugin(plugin, event); }}>
          <span>${plugin.enabled ? "已启用" : "已禁用"}</span>
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
  return html`启用或禁用 <strong>${targetLabel}</strong> 上发现的 PI WEB 浏览器插件。这与安装 Pi 包相互独立；请重新加载浏览器标签页以应用插件运行时更改。`;
}

function pluginSourceLabel(source: string): string {
  if (source === "bundled") return "内置";
  if (source === "local") return "本地";
  if (source === "dev") return "开发";
  return source;
}

function pluginScopeLabel(scope: PiWebPluginInfo["scope"]): string {
  switch (scope) {
    case "bundled": return "内置范围";
    case "local": return "本地范围";
    case "user": return "用户范围";
    case "project": return "项目范围";
  }
}

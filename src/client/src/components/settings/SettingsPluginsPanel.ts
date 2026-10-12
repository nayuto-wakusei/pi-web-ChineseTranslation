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
  @property() targetLabel = "本机（本地网关）";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onTogglePlugin?: (pluginId: string, enabled: boolean) => void | Promise<void>;

  override render(): TemplateResult {
    const plugins = settingsPluginRows(this.pluginsResponse, this.configResponse);
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
    if (this.savedMessage !== "") notices.push({ type: "success", content: this.savedNotice() });

    const runtime = this.pluginsResponse?.serverRuntime;
    if (runtime?.status === "unavailable") {
      notices.push({
        type: "availability",
        title: "服务端插件活动状态不可用",
        content: html`期望配置仍可编辑，但 PI WEB 无法验证 sessiond 的启动快照。 ${runtime.message ?? "请重启或重新连接 sessiond，然后重新加载。"}`,
      });
    } else if (runtime?.status === "incompatible") {
      notices.push({
        type: "error",
        title: "插件生命周期版本不匹配",
        content: html`${runtime.message ?? "Web 进程与会话守护进程的插件生命周期协议不一致。"} 加载依赖服务端的浏览器插件前，请更新并重启两个组件。`,
      });
    }
    if (runtime?.safeStart !== undefined) {
      notices.push({
        type: "warning",
        title: "服务端插件安全启动模式已生效",
        content: runtime.safeStart === "bundled-only"
          ? html`仅导入了内置服务端插件。清除安全启动模式： <code>${runtime.recovery.clearSafeStart}</code>.`
          : html`未导入任何服务端插件；终端不可用，核心目录工作区仍可用于诊断。清除安全启动模式： <code>${runtime.recovery.clearSafeStart}</code>.`,
      });
    }
    if (runtime?.desiredSafeStart !== undefined && runtime.desiredSafeStart !== (runtime.safeStart ?? "off")) {
      notices.push({
        type: "warning",
        title: "安全启动模式等待重启",
        content: runtime.desiredSafeStart === "off"
          ? "离线配置已清除安全启动模式，但在 sessiond 重启前仍保持生效。"
          : `离线配置请求 ${runtime.desiredSafeStart} 安全启动模式，将在下次 sessiond 重启时、插件导入前生效。`,
      });
    }
    if (runtime?.restartRequired === true) {
      notices.push({
        type: "warning",
        title: "需要重启会话守护进程",
        content: "期望插件配置或包版本与 sessiond 的启动快照不一致。重启 sessiond 可能中断活动会话。",
      });
    }
    for (const diagnostic of this.pluginsResponse?.diagnostics ?? []) {
      notices.push({
        type: diagnostic.kind === "conflict" ? "error" : "warning",
        title: diagnostic.kind === "conflict" ? "插件 ID 冲突" : "插件发现诊断",
        content: `${diagnostic.snapshot === "active" ? "活动快照" : "期望目录"}: ${diagnostic.message}`,
      });
    }
    if (showTrustedCodeWarning) {
      notices.push({
        type: "security",
        content: html`<strong>受信代码警告：</strong>PI WEB 插件和 Pi 包可使用你的用户权限运行。请仅启用可信来源的插件。`,
      });
    }
    return notices;
  }

  private savedNotice(): string {
    if (this.pluginsResponse?.serverRuntime.status !== "available" || this.pluginsResponse.serverRuntime.restartRequired) {
      return `${this.savedMessage} 重启会话守护进程以应用服务端插件更改；仅浏览器插件的更改在重新加载此标签页后生效。`;
    }
    return `${this.savedMessage} 重新加载浏览器标签页以应用仅浏览器插件的更改。`;
  }

  private shouldShowConfigUnavailableNotice(hasLoadedPlugins: boolean): boolean {
    return hasLoadedPlugins && this.configResponse === undefined && !this.loading && this.error === "";
  }

  private renderPanelContent(plugins: SettingsPluginRow[], hasPluginResponse: boolean): TemplateResult {
    if (!hasPluginResponse && plugins.length === 0) {
      return html`
        <div class="loading-card">${this.loading ? "正在加载 PI WEB 插件…" : `${this.targetLabel} 的 PI WEB 插件列表不可用，请重新加载。`}</div>
        ${this.renderRecoveryCommands()}
      `;
    }
    if (plugins.length === 0) {
      return html`
        <div class="loading-card">在 ${this.targetLabel} 上未发现或启用任何 PI WEB 插件。</div>
        ${this.renderRecoveryCommands()}
      `;
    }
    return html`
      <div class="plugin-note">${this.targetLabel} 上的配置键： <code>plugins</code>. 仅浏览器插件的更改在重新加载标签页后生效；依赖服务端的更改遵循 sessiond 的启动快照，可能需要手动重启。</div>
      <div class="plugin-list">
        ${plugins.map((plugin) => this.renderPlugin(plugin))}
      </div>
      ${this.renderRecoveryCommands()}
    `;
  }

  private renderPlugin(plugin: SettingsPluginRow): TemplateResult {
    const configured = this.configResponse?.config.plugins?.[plugin.id];
    const configuredState = plugin.required === true
      ? "必需插件 · 普通配置无法禁用"
      : !plugin.discovered && configured === undefined
        ? "期望包或配置不存在"
        : configured?.enabled === false ? "配置已禁用" : configured?.enabled === true ? "配置已启用" : "默认启用";
    return html`
      <article class=${`plugin-card${plugin.enabled ? "" : " disabled"}`}>
        <div class="plugin-main">
          <strong>${plugin.id}</strong>
          <small>${plugin.configOnly ? "仅有配置 · 未发现插件包" : `${pluginSourceLabel(plugin.source)} · ${pluginScopeLabel(plugin.scope)}${plugin.machineSpecific ? " · 机器专属" : ""}${plugin.required === true ? " · 必需" : ""}${plugin.discovered ? "" : " · 仅活动快照"}`}</small>
          <small>${configuredState}</small>
          ${this.renderPluginStatuses(plugin)}
          ${plugin.server?.message === undefined ? nothing : html`<small class="diagnostic">${plugin.server.message}</small>`}
          ${plugin.server?.health?.message === undefined ? nothing : html`<small class="diagnostic">健康状态：${plugin.server.health.message}</small>`}
          ${plugin.server === undefined || plugin.required === true ? nothing : html`<small class="command">离线禁用： <code>${plugin.server.disableCommand}</code></small>`}
        </div>
        <label class="toggle">
          <input type="checkbox" .checked=${plugin.enabled} ?disabled=${this.saving || this.configResponse === undefined || !plugin.editable} @change=${(event: Event) => { void this.togglePlugin(plugin, event); }}>
          <span>${plugin.required === true ? "必需插件" : "已启用"}</span>
        </label>
      </article>
    `;
  }

  private renderPluginStatuses(plugin: SettingsPluginRow): TemplateResult {
    const server = plugin.server;
    return html`
      <div class="status-list" aria-label=${`${plugin.id} 插件状态`}>
        ${server === undefined ? html`<span class="status neutral">${plugin.configOnly ? "仅有配置" : "仅浏览器"}</span>` : html`<span class=${`status ${serverStateTone(server.state)}`}>${serverStateLabel(server.state)}</span>`}
        ${plugin.conflict ? html`<span class="status error">冲突</span>` : nothing}
        ${server?.staleRevision === true ? html`<span class="status warning">版本过期</span>` : nothing}
        ${server?.restartRequired === true ? html`<span class="status warning">需要重启</span>` : nothing}
        ${server?.health === undefined ? nothing : html`<span class=${`status ${healthTone(server.health.status)}`}>健康状态 ${healthLabel(server.health.status)}</span>`}
      </div>
    `;
  }

  private renderRecoveryCommands(): TemplateResult | typeof nothing {
    const runtime = this.pluginsResponse?.serverRuntime;
    const responseRecovery = runtime?.status === "incompatible" && !this.recoveryCommandsSupported ? undefined : runtime?.recovery;
    const recovery = responseRecovery ?? (this.recoveryCommandsSupported ? PI_WEB_PLUGIN_RECOVERY_COMMANDS : undefined);
    if (recovery === undefined) return nothing;
    return html`
      <aside class="recovery" aria-label="离线服务端插件恢复命令">
        <strong>${this.targetLabel} 的离线恢复</strong>
        <small>这些命令不连接 sessiond、不导入插件，只编辑配置；命令中不包含机器凭据。</small>
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
    case "active": return "已激活";
    case "failed": return "失败";
    case "incompatible": return "不兼容";
    case "disabled": return "已禁用";
    case "missing": return "未激活";
    case "unknown": return "活动状态不可用";
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
  return html`比较期望插件配置与以下机器的 sessiond 活动启动快照： <strong>${targetLabel}</strong>. 这与安装 Pi 包相互独立。`;
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
function healthLabel(status: NonNullable<NonNullable<PiWebPluginInfo["server"]>["health"]>["status"]): string {
  switch (status) {
    case "healthy": return "正常";
    case "degraded": return "降级";
    case "unhealthy": return "异常";
  }
}

import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { spawnSessionsConfigPatch, subsessionsConfigPatch } from "./settingsSessiondConfig";

@customElement("settings-sessiond-panel")
export class SettingsSessiondPanel extends LitElement {
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property() targetLabel = "local (local gateway)";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues) => void | Promise<void>;

  override render(): TemplateResult {
    const config = this.configResponse;
    const spawnOverridden = config?.envOverrides.spawnSessions === true;
    // On by default: the effective config is the source of truth for the toggle
    // state, so an unset config file still shows the feature as enabled.
    const effectiveSpawn = config?.effectiveConfig.spawnSessions !== false;
    const subsessionsOverridden = config?.envOverrides.subsessions === true;
    // Beta, off by default; also requires spawn to be enabled.
    const effectiveSubsessions = config?.effectiveConfig.subsessions === true && effectiveSpawn;
    return html`
      <settings-panel-frame
        heading="会话守护进程"
        .description=${sessiondDescription(this.targetLabel)}
        actionLabel="重新加载"
        .actionDisabled=${this.loading}
        .notices=${this.panelNotices(config)}
        .onAction=${this.onReload}
      >
        ${config === undefined ? this.renderUnavailableConfigState() : html`
          <div class="config-path-card">
            <span>配置文件</span>
            <code>${config.path}</code>
          </div>
          <div class="field">
            <span class="field-heading">
              <span>允许代理启动会话</span>
              ${spawnOverridden ? html`<span class="override-badge">环境变量覆盖</span>` : null}
            </span>
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${effectiveSpawn}
                ?disabled=${this.loading || this.saving || spawnOverridden}
                @change=${(event: Event) => { void this.toggleSpawnSessions(event); }}
              >
              <span>启用 <code>spawn_session</code> 工具</span>
            </label>
            <small>启用后，LLM 可以启动新会话，但会被限制在同一个已注册项目的工作区（包括任意 worktree）内，因此每个派生会话都会显示在这里。默认启用。</small>
          </div>
          <div class="field">
            <span class="field-heading">
              <span>允许代理启动受跟踪的子会话</span>
              <span class="beta-badge">beta</span>
              ${subsessionsOverridden ? html`<span class="override-badge">环境变量覆盖</span>` : null}
            </span>
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${effectiveSubsessions}
                ?disabled=${this.loading || this.saving || subsessionsOverridden || !effectiveSpawn}
                @change=${(event: Event) => { void this.toggleSubsessions(event); }}
              >
              <span>启用 <code>spawn_subsession</code> 工具</span>
            </label>
            <small>Beta：代理可以启动自己持续关联的子会话（<code>spawn_subsession</code>、<code>list_subsessions</code>、<code>check_subsession</code>、<code>read_subsession</code>），并在子会话完成时收到通知。需要先启用“允许代理启动会话”。默认关闭。</small>
          </div>
          <section class="effective-card" aria-label="最终生效配置摘要">
            <h3>环境变量覆盖后的生效配置</h3>
            <dl>
              <div><dt>派生会话</dt><dd>${effectiveSpawn ? "已启用" : html`<span class="muted">已禁用</span>`}</dd></div>
              <div><dt>子会话</dt><dd>${effectiveSubsessions ? "已启用" : html`<span class="muted">已禁用</span>`}</dd></div>
            </dl>
          </section>
        `}
      </settings-panel-frame>
    `;
  }

  private panelNotices(config: PiWebConfigResponse | undefined): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    if (this.error !== "") notices.push({ type: "error", content: this.error });
    if (this.savedMessage !== "") notices.push({ type: "success", content: this.savedMessage });
    if (config !== undefined) {
      notices.push({
        type: "warning",
        title: `${this.targetLabel} 需要重启`,
        content: html`更改这些设置后，请在该机器上运行 <code>pi-web restart</code>，或重启其会话守护进程服务。`,
      });
    }
    return notices;
  }

  private renderUnavailableConfigState(): TemplateResult {
    return html`<div class="loading-card">${this.loading ? "正在加载配置…" : "配置不可用，请重新加载。"}</div>`;
  }

  private async toggleSpawnSessions(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(spawnSessionsConfigPatch(enabled));
  }

  private async toggleSubsessions(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(subsessionsConfigPatch(enabled));
  }

  static override styles = css`
    :host { display: block; }
    h3 { margin: 0; font-size: 13px; line-height: 1.3; }
    button, input { font: inherit; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .loading-card, .config-path-card, .effective-card { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .loading-card { color: var(--pi-muted); }
    .config-path-card { display: grid; gap: 5px; }
    .config-path-card span, .field-heading, dt { color: var(--pi-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .field { display: grid; gap: 7px; }
    .field small { color: var(--pi-muted); line-height: 1.45; }
    .field-heading { display: flex; align-items: center; gap: 8px; }
    .toggle { display: flex; align-items: center; gap: 9px; cursor: pointer; }
    .toggle input { width: 16px; height: 16px; }
    .toggle input:disabled { cursor: not-allowed; }
    .beta-badge { border: 1px solid var(--pi-border); border-radius: 999px; color: var(--pi-muted); background: var(--pi-bg); padding: 2px 7px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .effective-card { display: grid; gap: 10px; }
    .effective-card dl { display: grid; gap: 8px; margin: 0; }
    .effective-card dl > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; align-items: baseline; }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .muted { color: var(--pi-muted); }

    @media (max-width: 760px) {
      .effective-card dl > div { grid-template-columns: minmax(0, 1fr); gap: 3px; }
    }
  `;
}

function sessiondDescription(targetLabel: string): string {
  return `这些设置会影响 ${targetLabel} 上长生命周期的会话运行时。更改会立即保存，但只有在该机器的会话守护进程重启后才会生效。`;
}

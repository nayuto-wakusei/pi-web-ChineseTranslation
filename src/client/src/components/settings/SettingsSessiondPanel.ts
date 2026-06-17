import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";

@customElement("settings-sessiond-panel")
export class SettingsSessiondPanel extends LitElement {
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues) => void | Promise<void>;

  override render(): TemplateResult {
    const config = this.configResponse;
    const spawnOverridden = config?.envOverrides.spawnSessions === true;
    // On by default: the effective config is the source of truth for the toggle
    // state, so an unset config file still shows the feature as enabled.
    const effectiveSpawn = config?.effectiveConfig.spawnSessions !== false;
    return html`
      <div class="section-heading">
        <div>
          <h2>会话守护进程</h2>
          <p>这些设置会影响长生命周期的会话运行时。更改会立即保存到配置文件，但只有在会话守护进程重启后才会生效。</p>
        </div>
        <button class="secondary" ?disabled=${this.loading} @click=${() => { void this.onReload?.(); }}>重新加载</button>
      </div>
      ${this.renderMessages()}
      <div class="restart-note" role="note">需要重启：更改这些设置后，运行 <code>pi-web restart</code>，或重启会话守护进程服务。</div>
      ${config === undefined && this.loading ? html`<div class="loading-card">正在加载配置...</div>` : html`
        <div class="config-path-card">
          <span>配置文件</span>
          <code>${config?.path ?? "未知"}</code>
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
        <section class="effective-card" aria-label="生效配置摘要">
          <h3>应用环境变量覆盖后的生效配置</h3>
          <dl>
            <div><dt>派生会话</dt><dd>${effectiveSpawn ? "已启用" : html`<span class="muted">已禁用</span>`}</dd></div>
          </dl>
        </section>
      `}
    `;
  }

  private renderMessages(): TemplateResult | null {
    if (this.error !== "") return html`<div class="message error-message">${this.error}</div>`;
    if (this.savedMessage !== "") return html`<div class="message success-message">${this.savedMessage}</div>`;
    return null;
  }

  private async toggleSpawnSessions(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    const baseConfig = this.configResponse?.config ?? {};
    await this.onSave?.({ ...baseConfig, spawnSessions: enabled });
  }

  static override styles = css`
    :host { display: block; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
    .section-heading > div { display: grid; gap: 6px; min-width: 0; }
    h2, h3, p { margin: 0; }
    h2 { font-size: 17px; line-height: 1.25; }
    h3 { font-size: 13px; line-height: 1.3; }
    p { color: var(--pi-muted); line-height: 1.45; }
    button, input { font: inherit; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .secondary { flex: 0 0 auto; }
    .message, .loading-card, .config-path-card, .effective-card, .restart-note { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .message { margin-bottom: 12px; }
    .error-message { border-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); }
    .success-message { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-surface); }
    .loading-card { color: var(--pi-muted); }
    .restart-note { margin-bottom: 14px; border-color: var(--pi-warning-border); color: var(--pi-warning); background: var(--pi-warning-surface); line-height: 1.45; }
    .config-path-card { display: grid; gap: 5px; margin-bottom: 14px; }
    .config-path-card span, .field-heading, dt { color: var(--pi-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .field { display: grid; gap: 7px; margin-bottom: 14px; }
    .field small { color: var(--pi-muted); line-height: 1.45; }
    .field-heading { display: flex; align-items: center; gap: 8px; }
    .toggle { display: flex; align-items: center; gap: 9px; cursor: pointer; }
    .toggle input { width: 16px; height: 16px; }
    .toggle input:disabled { cursor: not-allowed; }
    .override-badge { border: 1px solid var(--pi-warning-border); border-radius: 999px; color: var(--pi-warning); background: var(--pi-warning-surface); padding: 2px 7px; font-size: 11px; font-weight: 600; text-transform: none; }
    .effective-card { display: grid; gap: 10px; }
    .effective-card dl { display: grid; gap: 8px; margin: 0; }
    .effective-card dl > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; align-items: baseline; }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .muted { color: var(--pi-muted); }

    @media (max-width: 760px) {
      .section-heading { display: grid; gap: 12px; }
      .section-heading .secondary { justify-self: start; }
      .effective-card dl > div { grid-template-columns: minmax(0, 1fr); gap: 3px; }
    }
  `;
}

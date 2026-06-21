import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { renderSettingsMessages, settingsPanelSharedStyles } from "./settingsPanelShared";

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
    const subsessionsOverridden = config?.envOverrides.subsessions === true;
    // Beta, off by default; also requires spawn to be enabled.
    const effectiveSubsessions = config?.effectiveConfig.subsessions === true && effectiveSpawn;
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
    `;
  }

  private renderMessages(): TemplateResult | null {
    return renderSettingsMessages(this.error, this.savedMessage);
  }

  private async toggleSpawnSessions(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    const baseConfig = this.configResponse?.config ?? {};
    await this.onSave?.({ ...baseConfig, spawnSessions: enabled });
  }

  private async toggleSubsessions(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    const baseConfig = this.configResponse?.config ?? {};
    await this.onSave?.({ ...baseConfig, subsessions: enabled });
  }

  static override styles = [settingsPanelSharedStyles, css`
    .restart-note { margin-bottom: 14px; border: 1px solid var(--pi-warning-border); border-radius: 10px; background: var(--pi-warning-surface); color: var(--pi-warning); padding: 12px; line-height: 1.45; }
    .field { margin-bottom: 14px; }
    .field small { line-height: 1.45; }
    .toggle { display: flex; align-items: center; gap: 9px; cursor: pointer; }
    .toggle input { width: 16px; height: 16px; }
    .toggle input:disabled { cursor: not-allowed; }
    .beta-badge { border: 1px solid var(--pi-border); border-radius: 999px; color: var(--pi-muted); background: var(--pi-bg); padding: 2px 7px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  `];
}

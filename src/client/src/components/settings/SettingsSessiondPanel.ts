import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ActiveAgentProfileDescriptor, PiWebConfigResponse, PiWebConfigValues } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { agentProfileConfigPatchFromDraft, agentProfileDraftFromConfig, agentProfileDraftMatchesConfig, emptyAgentProfileConfigDraft, type AgentProfileConfigDraft } from "./settingsConfigDraft";
import type { AgentProfileSettingsSupport } from "./settingsMachineTarget";
import { agentDirFieldOverridden, agentProfileActivationState, askUserConfigPatch, spawnSessionsConfigPatch, subsessionsConfigPatch } from "./settingsSessiondConfig";

@customElement("settings-sessiond-panel")
export class SettingsSessiondPanel extends LitElement {
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property() targetLabel = "本机（本地网关）";
  @property({ attribute: false }) activeAgentProfile: ActiveAgentProfileDescriptor | undefined;
  @property({ attribute: false }) agentProfileSupport: AgentProfileSettingsSupport = { state: "supported" };
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues) => void | Promise<void>;
  @state() private agentDraft: AgentProfileConfigDraft = emptyAgentProfileConfigDraft();
  @state() private agentDraftDirty = false;
  @state() private agentLocalError = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("configResponse")) return;
    if (this.configResponse === undefined) {
      this.agentDraft = emptyAgentProfileConfigDraft();
      this.agentDraftDirty = false;
      this.agentLocalError = "";
      return;
    }
    if (!this.agentDraftDirty || agentProfileDraftMatchesConfig(this.agentDraft, this.configResponse.config)) {
      this.agentDraft = agentProfileDraftFromConfig(this.configResponse.config);
      this.agentDraftDirty = false;
      this.agentLocalError = "";
    }
  }

  override render(): TemplateResult {
    const config = this.configResponse;
    const spawnOverridden = config?.envOverrides.spawnSessions === true;
    // On by default: the effective config is the source of truth for the toggle
    // state, so an unset config file still shows the feature as enabled.
    const effectiveSpawn = config?.effectiveConfig.spawnSessions !== false;
    const subsessionsOverridden = config?.envOverrides.subsessions === true;
    // On by default; also requires spawn to be enabled.
    const effectiveSubsessions = config?.effectiveConfig.subsessions === true && effectiveSpawn;
    // Current servers always resolve this on-by-default setting. Absence means
    // an older selected machine cannot persist it yet.
    const askUserSupported = config?.effectiveConfig.askUser !== undefined;
    const askUserOverridden = config?.envOverrides.askUser === true;
    const effectiveAskUser = config?.effectiveConfig.askUser === true;
    const agentCommandOverridden = config?.envOverrides.agentCommand === true;
    const profileEditingSupported = this.agentProfileSupport.state === "supported";
    const draftCommand = agentCommandOverridden ? (config.effectiveConfig.agent?.command ?? this.agentDraft.command) : this.agentDraft.command;
    const agentDirLocked = agentDirFieldOverridden(config?.envOverrides, draftCommand);
    const effectiveAgentDirOverridden = config?.envOverrides.agentDir === true;
    const effectiveAgent = config?.effectiveConfig.agent;
    const profileActivation = agentProfileActivationState(config, this.activeAgentProfile);
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
          <form class="profile-form" aria-label="Pi 兼容代理配置档案" @submit=${(event: Event) => { void this.saveAgentProfile(event); }}>
            ${profileEditingSupported ? null : html`<div class="profile-support-message">${this.agentProfileSupport.message ?? "此机器不支持编辑 Pi 兼容代理配置档案。"}</div>`}
            <label class="field">
              <span class="field-heading">
                <span>配套 CLI 命令</span>
                ${agentCommandOverridden ? html`<span class="override-badge">环境变量覆盖</span>` : null}
              </span>
              <input
                class="text-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                .value=${this.agentDraft.command}
                placeholder="pi"
                ?disabled=${this.loading || this.saving || !profileEditingSupported || agentCommandOverridden}
                @input=${(event: Event) => { this.updateAgentDraft({ command: inputValue(event) }); }}
              >
              <small>设置诊断和更新检查所用的 Pi 兼容配套 CLI。内嵌会话运行时仍使用 PI WEB 捆绑的 Pi SDK。</small>
            </label>
            <label class="field">
              <span class="field-heading">
                <span>配置档案状态目录</span>
                ${effectiveAgentDirOverridden ? html`<span class="override-badge">环境变量覆盖</span>` : null}
              </span>
              <input
                class="text-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                .value=${this.agentDraft.dir}
                placeholder="~/.pi/agent 或 ~/agent-profiles/work"
                ?disabled=${this.loading || this.saving || !profileEditingSupported || agentDirLocked}
                @input=${(event: Event) => { this.updateAgentDraft({ dir: inputValue(event) }); }}
              >
              <small>选择 PI WEB 读取的 Pi 兼容认证、模型、设置和会话目录。备用命令会与其所需状态目录一并保存。</small>
            </label>
            <footer class="form-actions">
              <button class="primary" type="submit" ?disabled=${this.loading || this.saving || !profileEditingSupported || (agentCommandOverridden && agentDirLocked)}>${this.saving ? "正在保存…" : "保存代理配置档案"}</button>
            </footer>
          </form>
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
            <small>代理可以启动自己持续关联的子会话（<code>spawn_subsession</code>、<code>list_subsessions</code>、<code>check_subsession</code>、<code>read_subsession</code>），并在子会话完成时收到通知。需要先启用“允许代理启动会话”。默认启用。</small>
          </div>
          <div class="field">
            <span class="field-heading">
              <span>允许代理提问</span>
              ${askUserOverridden ? html`<span class="override-badge">环境变量覆盖</span>` : null}
            </span>
            <label class="toggle">
              <input
                type="checkbox"
                aria-label="启用代理提问"
                .checked=${effectiveAskUser}
                ?disabled=${this.loading || this.saving || askUserOverridden || !askUserSupported}
                @change=${(event: Event) => { void this.toggleAskUser(event); }}
              >
              <span>启用 <code>ask_user</code> 工具</span>
            </label>
            <small>${askUserSupported
              ? html`代理可以发出结构化问题表单，并暂停等待用户回答。默认启用。`
              : html`当前机器未提供代理提问设置。请更新并重启该机器上的 PI WEB。`}</small>
          </div>
          <section class="effective-card" aria-label="最终生效配置摘要">
            <h3>环境变量覆盖后的生效配置</h3>
            <dl>
              <div><dt>期望命令</dt><dd>${effectiveAgent?.command ?? html`<span class="muted">不可用</span>`}</dd></div>
              <div><dt>期望状态目录</dt><dd>${effectiveAgent?.dir ?? html`<span class="muted">不可用</span>`}</dd></div>
              <div><dt>当前命令</dt><dd>${this.activeAgentProfile?.command ?? html`<span class="muted">不可用</span>`}</dd></div>
              <div><dt>当前状态目录</dt><dd>${this.activeAgentProfile?.dir ?? html`<span class="muted">不可用</span>`}</dd></div>
              <div><dt>配置档案状态</dt><dd>${profileActivationLabel(profileActivation)}</dd></div>
              <div><dt>派生会话</dt><dd>${effectiveSpawn ? "已启用" : html`<span class="muted">已禁用</span>`}</dd></div>
              <div><dt>子会话</dt><dd>${effectiveSubsessions ? "已启用" : html`<span class="muted">已禁用</span>`}</dd></div>
              <div><dt>代理提问</dt><dd>${!askUserSupported ? html`<span class="muted">不可用</span>` : effectiveAskUser ? "已启用" : html`<span class="muted">已禁用</span>`}</dd></div>
            </dl>
          </section>
        `}
      </settings-panel-frame>
    `;
  }

  private panelNotices(config: PiWebConfigResponse | undefined): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    const error = this.agentLocalError || this.error;
    if (error !== "") notices.push({ type: "error", content: error });
    if (this.savedMessage !== "") notices.push({ type: "success", content: this.savedMessage });
    const activation = agentProfileActivationState(config, this.activeAgentProfile);
    if (activation === "restart-required") {
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

  private async saveAgentProfile(event: Event): Promise<void> {
    event.preventDefault();
    this.agentLocalError = "";
    try {
      await this.onSave?.(agentProfileConfigPatchFromDraft(this.agentDraft));
    } catch (error) {
      this.agentLocalError = errorMessage(error);
    }
  }

  private updateAgentDraft(patch: Partial<AgentProfileConfigDraft>): void {
    this.agentDraft = { ...this.agentDraft, ...patch };
    this.agentDraftDirty = true;
    this.agentLocalError = "";
  }

  private async toggleSpawnSessions(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(spawnSessionsConfigPatch(enabled));
  }

  private async toggleSubsessions(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(subsessionsConfigPatch(enabled));
  }

  private async toggleAskUser(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(askUserConfigPatch(enabled));
  }

  static override styles = css`
    :host { display: block; }
    h3 { margin: 0; font-size: 13px; line-height: 1.3; }
    button, input { font: inherit; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .loading-card, .config-path-card, .effective-card, .profile-support-message { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .loading-card { color: var(--pi-muted); }
    .config-path-card { display: grid; gap: 5px; }
    .profile-form { display: grid; gap: 14px; }
    .profile-support-message { color: var(--pi-muted); line-height: 1.45; }
    .form-actions { display: flex; justify-content: flex-end; }
    .primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-accent-contrast); }
    .config-path-card span, .field-heading, dt { color: var(--pi-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .field { display: grid; gap: 7px; }
    .field small { color: var(--pi-muted); line-height: 1.45; }
    .field-heading { display: flex; align-items: center; gap: 8px; }
    .toggle { display: flex; align-items: center; gap: 9px; cursor: pointer; }
    .toggle input { width: 16px; height: 16px; }
    .text-input {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      border: 1px solid var(--pi-border);
      border-radius: 8px;
      background: var(--pi-bg);
      color: var(--pi-text);
      padding: 8px 9px;
      outline: none;
      font: var(--pi-control-font-size, 16px) var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    }
    .text-input:focus { border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent-border); }
    .text-input:disabled { opacity: .55; cursor: not-allowed; }
    .toggle input:disabled { cursor: not-allowed; }
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

function profileActivationLabel(state: ReturnType<typeof agentProfileActivationState>): string | TemplateResult {
  if (state === "active") return "已生效";
  if (state === "restart-required") return "需要重启";
  return html`<span class="muted">不可用</span>`;
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sessiondDescription(targetLabel: string): string {
  return `这些设置会影响 ${targetLabel} 上长生命周期的会话运行时。更改会立即保存，但只有在该机器的会话守护进程重启后才会生效。`;
}

export interface SessiondPanelNoticeContext {
  readonly error: string;
  readonly savedMessage: string;
  readonly activeProfile: ActiveAgentProfileDescriptor | undefined;
  readonly targetLabel: string;
  readonly profileEditingSupported: boolean;
}

/**
 * Compute the session-daemon panel's notice stack (error, saved, and
 * profile-activation guidance) as a pure, publicly testable seam so tests assert
 * the dynamic notice logic and ordering here instead of scraping rendered
 * `TemplateResult` internals.
 */
export function sessiondPanelNotices(
  config: PiWebConfigResponse | undefined,
  context: SessiondPanelNoticeContext,
): readonly SettingsNotice[] {
  const notices: SettingsNotice[] = [];
  if (context.error !== "") notices.push({ type: "error", content: context.error });
  if (context.savedMessage !== "") notices.push({ type: "success", content: context.savedMessage });
  const activation = agentProfileActivationState(config, context.activeProfile);
  if (activation === "restart-required") {
    notices.push({
      type: "warning",
      title: `${context.targetLabel} 上的 Pi 兼容代理配置档案需要重启`,
      content: html`期望配置档案与当前会话守护进程配置档案不同。请在该机器上运行 <code>pi-web restart</code>（或重启其会话守护进程服务），以同时应用命令和状态目录。`,
    });
  } else if (config !== undefined && activation === "unavailable" && context.profileEditingSupported) {
    notices.push({
      type: "info",
      title: `无法获取 ${context.targetLabel} 上当前生效的 Pi 兼容代理配置档案`,
      content: "PI WEB 无法比较期望配置档案与正在运行的会话守护进程配置档案。请在守护进程可用后重新加载。",
    });
  }
  return notices;
}

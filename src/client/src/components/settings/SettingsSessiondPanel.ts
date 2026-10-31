
import { live } from "lit/directives/live.js";
import { LocalizationController, localization } from "../../localization/browser";
import source from "./settingsSessiond.messages";

import { enforcedSetting, settingControls, type ResetSettings } from "./settingsConfigUpdate";
import { uiSettingsStyles } from "../ui/settingsStyles";
import { uiButtonStyles } from "../ui/controlStyles";
import { uiFormStyles } from "../ui/formStyles";
import { stylesheetIntegrationCapability } from "../../plugins/styles";
import { t } from "../../i18n";
import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ActiveAgentProfileDescriptor, PiWebConfigResponse, PiWebConfigValues } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { agentProfileConfigPatchFromDraft, agentProfileDraftFromConfig, agentProfileDraftMatchesConfig, emptyAgentProfileConfigDraft, type AgentProfileConfigDraft } from "./settingsConfigDraft";
import type { AgentProfileSettingsSupport } from "./settingsMachineTarget";
import { agentDirFieldOverridden, agentProfileActivationState, askUserConfigPatch, sessionMessagesConfigPatch, spawnSessionsConfigPatch, subsessionsConfigPatch } from "./settingsSessiondConfig";

export const sessiondMessages = localization.registerMessages("core.settingsSessiond", source);
const codeTag = (chunks: unknown[]): TemplateResult => html`<code dir="ltr">${chunks}</code>`;

@customElement("settings-sessiond-panel")
export class SettingsSessiondPanel extends LitElement {
  constructor() {
    super();
    new LocalizationController(this);
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property() targetLabel = "";
  @property({ attribute: false }) activeAgentProfile: ActiveAgentProfileDescriptor | undefined;
  @property({ attribute: false }) agentProfileSupport: AgentProfileSettingsSupport = { state: "supported" };
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues, unset?: string[]) => void | Promise<void>;
  @property({ attribute: false }) onReset?: ResetSettings;
  @property() targetId = "local";
  @state() private agentDraft: AgentProfileConfigDraft = emptyAgentProfileConfigDraft();
  @state() private agentDraftDirty = false;
  @state() private agentLocalError = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("targetId")) {
      this.agentDraft = emptyAgentProfileConfigDraft();
      this.agentDraftDirty = false;
      this.agentLocalError = "";
    }
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
    const response = this.configResponse;
    const config = response;
    const targetId = this.targetId;
    const spawnOverridden = enforcedSetting(config, "/spawnSessions") !== undefined;
    // On by default: use saved effective values, not running daemon state.
    const effectiveSpawn = config?.effectiveConfig.spawnSessions !== false;
    const subsessionsOverridden = enforcedSetting(config, "/subsessions") !== undefined;
    const effectiveSubsessions = config?.effectiveConfig.subsessions === true && effectiveSpawn;
    const sessionMessagesOverridden = enforcedSetting(config, "/sessionMessages") !== undefined;
    const effectiveSessionMessages = config?.effectiveConfig.sessionMessages !== false;
    const askUserOverridden = enforcedSetting(config, "/askUser") !== undefined;
    const askUserSupported = config?.effectiveConfig.askUser !== undefined;
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
        .heading=${sessiondMessages.t("heading")}
        .description=${sessiondMessages.t("description", { target: this.targetLabel || sessiondMessages.t("selectedMachine") })}
        .actionLabel=${sessiondMessages.t("refresh")}
        .actionDisabled=${this.loading || this.saving}
        .notices=${this.panelNotices(config)}
        .onAction=${this.onReload}
      >
        <section class="ui-settings-section">
        ${config === undefined ? html`<div class="loading-card">${sessiondMessages.t(this.loading ? "loading" : "unavailable")}</div>` : html`
          <div class="config-path-card ui-settings-path">
            <span>${sessiondMessages.t("configFile")}</span>
            <code dir="ltr">${config.path}</code>
          </div>
          <form class="profile-form ui-settings-fields" aria-label="${t("ui.settingsSessiondPanel.piCompatibleAgentProfile", "Pi-compatible agent profile")}" @submit=${(event: Event) => { void this.saveAgentProfile(event, targetId); }}>
            ${profileEditingSupported ? null : html`<div class="profile-support-message">${this.agentProfileSupport.message ?? t("ui.settingsSessiondPanel.thisMachineDoesNotSupportEditingPiCompatible", "This machine does not support editing Pi-compatible agent profiles.")}</div>`}
            <label class="field ui-form-field">
              <span class="field-heading">
                <span>${t("ui.settingsSessiondPanel.companionCliCommand", "Companion CLI command")}</span>
                ${agentCommandOverridden ? html`<span class="override-badge">${t("ui.settingsGeneralPanel.environmentOverrides", "Environment overrides")}</span>` : null}
              </span>
              <input
                class="text-input ui-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                .value=${this.agentDraft.command}
                placeholder="pi"
                ?disabled=${this.loading || this.saving || !profileEditingSupported || agentCommandOverridden}
                @input=${(event: Event) => { this.updateAgentDraft({ command: inputValue(event) }); }}
              >
              <small>${t("ui.settingsSessiondPanel.setThePiCompatibleCompanionCliUsedFor", "Set the Pi-compatible companion CLI used for diagnostics and update checks. Embedded sessions still use the Pi SDK bundled with PI WEB.")}</small>
            </label>
            <label class="field ui-form-field">
              <span class="field-heading">
                <span>${t("ui.settingsSessiondPanel.profileStateDirectory", "Profile state directory")}</span>
                ${effectiveAgentDirOverridden ? html`<span class="override-badge">${t("ui.settingsGeneralPanel.environmentOverrides", "Environment overrides")}</span>` : null}
              </span>
              <input
                class="text-input ui-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                .value=${this.agentDraft.dir}
                placeholder="${t("ui.settingsSessiondPanel.piAgentOrAgentProfilesWork", "~/.pi/agent or ~/agent-profiles/work")}"
                ?disabled=${this.loading || this.saving || !profileEditingSupported || agentDirLocked}
                @input=${(event: Event) => { this.updateAgentDraft({ dir: inputValue(event) }); }}
              >
              <small>${t("ui.settingsSessiondPanel.chooseThePiCompatibleAuthenticationModelSettingsAnd", "Choose the Pi-compatible authentication, model, settings, and session directory PI WEB reads. Alternate commands are saved with their required state directory.")}</small>
            </label>
            <footer class="form-actions ui-settings-actions">
              <button class="primary ui-button ui-button--action ui-button--primary" type="submit" ?disabled=${this.loading || this.saving || !profileEditingSupported || (agentCommandOverridden && agentDirLocked)}>${this.saving ? t("ui.settingsGeneralPanel.saving", "Saving…") : t("ui.settingsSessiondPanel.saveAgentProfile", "Save agent profile")}</button>
            </footer>
          </form>
          <div class="field ui-form-field">
            <span class="field-heading">
              <span>${t("ui.settingsSessiondPanel.allowAgentsToStartSessions", "Allow agents to start sessions")}</span>
              ${spawnOverridden ? html`<span class="override-badge">${t("ui.settingsGeneralPanel.environmentOverrides", "Environment overrides")}</span>` : null}
            </span>
            <label class="toggle ui-checkbox-field">
              <input type="checkbox" id="spawn-sessions" aria-describedby="spawn-sessions-help"
                .checked=${live(effectiveSpawn)} ?disabled=${this.loading || this.saving || spawnOverridden}
                @change=${(event: Event) => { void this.toggleSpawnSessions(event); }}>
              <span>${sessiondMessages.t("spawn")}</span>
            </label>
            <small id="spawn-sessions-help">
              ${sessiondMessages.rich("spawnHelp", { code: codeTag, tool: "spawn_session" })}
              ${spawnOverridden ? sessiondMessages.rich("envOverride", { variable: "PI_WEB_SPAWN_SESSIONS", code: codeTag }) : null}
            </small>
          </div>
          <div class="field ui-form-field">
            <span class="field-heading">
              <span>${t("ui.settingsSessiondPanel.allowAgentsToStartTrackedSubsessions", "Allow agents to start tracked subsessions")}</span>
              ${subsessionsOverridden ? html`<span class="override-badge">${t("ui.settingsGeneralPanel.environmentOverrides", "Environment overrides")}</span>` : null}
            </span>
            <label class="toggle ui-checkbox-field">
              <input type="checkbox" id="subsessions" aria-describedby="subsessions-help"
                .checked=${live(effectiveSubsessions)} ?disabled=${this.loading || this.saving || subsessionsOverridden || !effectiveSpawn}
                @change=${(event: Event) => { void this.toggleSubsessions(event); }}>
              <span>${sessiondMessages.t("subsessions")}</span>
            </label>
            <small id="subsessions-help">
              ${sessiondMessages.rich("subsessionsHelp", { code: codeTag, spawn: "spawn_subsession", list: "list_subsessions", check: "check_subsession", read: "read_subsession" })}
              ${sessiondMessages.t(!effectiveSpawn ? "enableSpawn" : "spawnRequired")}
              ${subsessionsOverridden ? sessiondMessages.rich("envOverride", { variable: "PI_WEB_SUBSESSIONS", code: codeTag }) : null}
            </small>
          </div>
          <div class="field ui-form-field">
            <span class="field-heading">
              <span>${t("ui.settingsSessiondPanel.allowAgentsToAskQuestions", "Allow agents to ask questions")}</span>
              ${askUserOverridden ? html`<span class="override-badge">${t("ui.settingsGeneralPanel.environmentOverrides", "Environment overrides")}</span>` : null}
            </span>
            <label class="toggle ui-checkbox-field">
              <input type="checkbox" id="session-messages" aria-describedby="session-messages-help"
                .checked=${live(effectiveSessionMessages)} ?disabled=${this.loading || this.saving || sessionMessagesOverridden}
                @change=${(event: Event) => { void this.toggleSessionMessages(event); }}>
              <span>${sessiondMessages.t("sessionMessages")}</span>
            </label>
            <small id="session-messages-help">
              ${sessiondMessages.rich("sessionMessagesHelp", { code: codeTag, tool: "send_session_message" })}
              ${sessionMessagesOverridden ? sessiondMessages.rich("envOverride", { variable: "PI_WEB_SESSION_MESSAGES", code: codeTag }) : null}
            </small>
          </div>
          <div class="field ui-form-field">
            <label class="toggle ui-checkbox-field">
              <input type="checkbox" id="ask-user" aria-describedby="ask-user-help" aria-label=${sessiondMessages.t("askUser")}
                .checked=${live(effectiveAskUser)} ?disabled=${this.loading || this.saving || askUserOverridden || !askUserSupported}
                @change=${(event: Event) => { void this.toggleAskUser(event); }}>
              <span>${sessiondMessages.t("askUser")}</span>
            </label>
            <small id="ask-user-help">
              ${sessiondMessages.rich("askUserHelp", { code: codeTag, tool: "ask_user" })}
              ${askUserOverridden ? sessiondMessages.rich("envOverride", { variable: "PI_WEB_ASK_USER", code: codeTag }) : null}
            </small>
          </div>
          ${["spawnSessions", "subsessions", "sessionMessages", "askUser"].map((key) => settingControls(config, `/${key}`, this.loading || this.saving, this.onReset))}
          <section class="effective-card ui-settings-summary" aria-labelledby="restart-summary-heading" aria-describedby="restart-summary-help">
            <h3 id="restart-summary-heading">${sessiondMessages.t("restartHeading")}</h3>
            <small id="restart-summary-help">${sessiondMessages.t("restartHelp")}</small>
            <dl>
              <div><dt>${t("ui.settingsSessiondPanel.desiredCommand", "Desired command")}</dt><dd>${effectiveAgent?.command ?? t("bundled.info.unavailable.460b35", "Unavailable")}</dd></div>
              <div><dt>${t("ui.settingsSessiondPanel.desiredStateDirectory", "Desired state directory")}</dt><dd>${effectiveAgent?.dir ?? t("bundled.info.unavailable.460b35", "Unavailable")}</dd></div>
              <div><dt>${t("ui.settingsSessiondPanel.currentStateDirectory", "Current state directory")}</dt><dd>${this.activeAgentProfile?.dir ?? t("bundled.info.unavailable.460b35", "Unavailable")}</dd></div>
              <div><dt>${t("ui.settingsSessiondPanel.profileStatus", "Profile status")}</dt><dd>${profileActivationLabel(profileActivation)}</dd></div>
              <div><dt>${sessiondMessages.t("spawnSummary")}</dt><dd>${effectiveSpawn ? sessiondMessages.t("enabled") : html`<span class="muted">${sessiondMessages.t("disabled")}</span>`}</dd></div>
              <div><dt>${sessiondMessages.t("subsessionsSummary")}</dt><dd>${effectiveSubsessions ? sessiondMessages.t("enabled") : html`<span class="muted">${sessiondMessages.t("disabled")}</span>`}</dd></div>
              <div><dt>${sessiondMessages.t("sessionMessagesSummary")}</dt><dd>${effectiveSessionMessages ? sessiondMessages.t("enabled") : html`<span class="muted">${sessiondMessages.t("disabled")}</span>`}</dd></div>
              <div><dt>${sessiondMessages.t("askUserSummary")}</dt><dd>${effectiveAskUser ? sessiondMessages.t("enabled") : html`<span class="muted">${sessiondMessages.t("disabled")}</span>`}</dd></div>
            </dl>
          </section>
        `}
        </section>
      </settings-panel-frame>
    `;
  }

  private panelNotices(config: PiWebConfigResponse | undefined): readonly SettingsNotice[] {
    return sessiondPanelNotices(config, {
      error: this.agentLocalError || this.error,
      savedMessage: this.savedMessage,
      activeProfile: this.activeAgentProfile,
      targetLabel: this.targetLabel,
      profileEditingSupported: this.agentProfileSupport.state === "supported",
    });
  }

  private renderUnavailableConfigState(): TemplateResult {
    return html`<div class="loading-card">${sessiondMessages.t(this.loading ? "loading" : "unavailable")}</div>`;
  }

  private async saveAgentProfile(event: Event, targetId = this.targetId): Promise<void> {
    event.preventDefault();
    if (targetId !== this.targetId || this.loading || this.saving || this.agentProfileSupport.state !== "supported" || this.configResponse === undefined) return;
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

  private async toggleSessionMessages(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(sessionMessagesConfigPatch(enabled));
  }

  private async toggleAskUser(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(askUserConfigPatch(enabled));
  }

  static override styles = [uiButtonStyles, uiFormStyles, uiSettingsStyles, css`
    @layer pi-web-base {
    :host { display: block; }
    h3 { margin: 0; font-size: 13px; line-height: 1.3; }
    .loading-card { color: var(--pi-muted); }
    .config-path-card span, dt { color: var(--pi-muted); font-size: 12px; font-weight: 600; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); overflow-wrap: anywhere; }
    .field small, .effective-card small { color: var(--pi-muted); line-height: 1.45; }
    .effective-card dl { display: grid; gap: 8px; margin: 0; }
    .effective-card dl > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; align-items: baseline; }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .muted { color: var(--pi-muted); }

    @media (max-width: 760px) {
      .effective-card dl > div { grid-template-columns: minmax(0, 1fr); gap: 3px; }
    }

    }
  `];
}

function profileActivationLabel(state: ReturnType<typeof agentProfileActivationState>): string | TemplateResult {
  if (state === "active") return t("ui.settingsSessiondPanel.applied", "Applied");
  if (state === "restart-required") return t("bundled.info.restart.needed.1ffd00", "Restart needed");
  return html`<span class="muted">${t("bundled.info.unavailable.460b35", "Unavailable")}</span>`;
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sessiondDescription(targetLabel: string): string {
  return sessiondMessages.t("description", { target: targetLabel });
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
      title: t("ui.settingsSessiondPanel.piCompatibleAgentProfileOnRequiresARestart", "Pi-compatible agent profile on {targetLabel} requires a restart", { targetLabel: context.targetLabel }),
      content: html`${t("ui.main.cbc1edd666c2", "The desired state directory differs from the running session daemon. On that machine, run ")} <code>pi-web restart</code>${t("ui.main.44de61cea1d8", " (or restart its session daemon service) to apply the state directory.")}`,
    });
  } else if (config !== undefined && activation === "unavailable" && context.profileEditingSupported) {
    notices.push({
      type: "info",
      title: t("ui.settingsSessiondPanel.unableToGetTheActivePiCompatibleAgent", "Unable to get the active Pi-compatible agent profile on {targetLabel}", { targetLabel: context.targetLabel }),
      content: t("ui.settingsSessiondPanel.piWebCannotCompareTheDesiredProfileWith", "PI WEB cannot compare the desired profile with the running session daemon profile. Reload when the daemon is available."),
    });
  }
  return notices;
}

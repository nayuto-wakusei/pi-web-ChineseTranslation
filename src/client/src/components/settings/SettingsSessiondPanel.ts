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
import { agentDirFieldOverridden, agentProfileActivationState, askUserConfigPatch, spawnSessionsConfigPatch, subsessionsConfigPatch } from "./settingsSessiondConfig";

@customElement("settings-sessiond-panel")
export class SettingsSessiondPanel extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property() targetLabel = t("ui.settingsSessiondPanel.localLocalGateway", "Local (local gateway)");
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
        heading="${t("bundled.updates.session.daemon.757666", "Session daemon")}"
        .description=${sessiondDescription(this.targetLabel)}
        actionLabel="${t("ui.settingsPackagesPanel.reload", "Reload")}"
        .actionDisabled=${this.loading}
        .notices=${this.panelNotices(config)}
        .onAction=${this.onReload}
      >
        ${config === undefined ? this.renderUnavailableConfigState() : html`
          <div class="config-path-card ui-settings-path">
            <span>${t("ui.settingsShortcutsPanel.configurationFile", "Configuration file")}</span>
            <code>${config.path}</code>
          </div>
          <form class="profile-form ui-settings-fields" aria-label="${t("ui.settingsSessiondPanel.piCompatibleAgentProfile", "Pi-compatible agent profile")}" @submit=${(event: Event) => { void this.saveAgentProfile(event); }}>
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
              <input
                type="checkbox"
                .checked=${effectiveSpawn}
                ?disabled=${this.loading || this.saving || spawnOverridden}
                @change=${(event: Event) => { void this.toggleSpawnSessions(event); }}
              >
              <span>${t("ui.settingsSessiondPanel.enable", "Enable")} <code>spawn_session</code> ${t("ui.chatView.tool", "Tool")}</span>
            </label>
            <small>${t("ui.settingsSessiondPanel.whenEnabledTheLlmCanStartSessionsWithin", "When enabled, the LLM can start sessions within workspaces of the same registered project, including any worktree, so every spawned session appears here. Enabled by default.")}</small>
          </div>
          <div class="field ui-form-field">
            <span class="field-heading">
              <span>${t("ui.settingsSessiondPanel.allowAgentsToStartTrackedSubsessions", "Allow agents to start tracked subsessions")}</span>
              ${subsessionsOverridden ? html`<span class="override-badge">${t("ui.settingsGeneralPanel.environmentOverrides", "Environment overrides")}</span>` : null}
            </span>
            <label class="toggle ui-checkbox-field">
              <input
                type="checkbox"
                .checked=${effectiveSubsessions}
                ?disabled=${this.loading || this.saving || subsessionsOverridden || !effectiveSpawn}
                @change=${(event: Event) => { void this.toggleSubsessions(event); }}
              >
              <span>${t("ui.settingsSessiondPanel.enable", "Enable")} <code>spawn_subsession</code> ${t("ui.chatView.tool", "Tool")}</span>
            </label>
            <small>${t("ui.main.ff88ab94196f", "Agents can start child sessions they stay attached to (")}<code>spawn_subsession</code>${t("bundled.info.list.separator", ", ")}<code>list_subsessions</code>${t("bundled.info.list.separator", ", ")}<code>check_subsession</code>${t("bundled.info.list.separator", ", ")}<code>read_subsession</code>${t("ui.main.c36dc9dce940", ") and are notified when a child finishes. Requires \"Allow agents to start sessions\". On by default.")}</small>
          </div>
          <div class="field ui-form-field">
            <span class="field-heading">
              <span>${t("ui.settingsSessiondPanel.allowAgentsToAskQuestions", "Allow agents to ask questions")}</span>
              ${askUserOverridden ? html`<span class="override-badge">${t("ui.settingsGeneralPanel.environmentOverrides", "Environment overrides")}</span>` : null}
            </span>
            <label class="toggle ui-checkbox-field">
              <input
                type="checkbox"
                aria-label="${t("ui.settingsSessiondPanel.enableAgentQuestions", "Enable agent questions")}"
                .checked=${effectiveAskUser}
                ?disabled=${this.loading || this.saving || askUserOverridden || !askUserSupported}
                @change=${(event: Event) => { void this.toggleAskUser(event); }}
              >
              <span>${t("ui.settingsSessiondPanel.enable", "Enable")} <code>ask_user</code> ${t("ui.chatView.tool", "Tool")}</span>
            </label>
            <small>${askUserSupported
              ? html`${t("ui.settingsSessiondPanel.agentsCanPresentStructuredQuestionFormsAndPause", "Agents can present structured question forms and pause for answers. Enabled by default.")}`
              : html`${t("ui.settingsSessiondPanel.thisMachineDoesNotProvideAgentQuestionSettings", "This machine does not provide agent question settings. Update and restart PI WEB on that machine.")}`}</small>
          </div>
          <section class="effective-card ui-settings-summary" aria-label="${t("ui.settingsGeneralPanel.effectiveConfigurationSummary", "Effective configuration summary")}">
            <h3>${t("ui.settingsSessiondPanel.effectiveConfigurationAfterEnvironmentOverrides", "Effective configuration after environment overrides")}</h3>
            <dl>
              <div><dt>${t("ui.settingsSessiondPanel.desiredCommand", "Desired command")}</dt><dd>${effectiveAgent?.command ?? html`<span class="muted">${t("bundled.info.unavailable.460b35", "Unavailable")}</span>`}</dd></div>
              <div><dt>${t("ui.settingsSessiondPanel.desiredStateDirectory", "Desired state directory")}</dt><dd>${effectiveAgent?.dir ?? html`<span class="muted">${t("bundled.info.unavailable.460b35", "Unavailable")}</span>`}</dd></div>
              <div><dt>${t("ui.settingsSessiondPanel.currentStateDirectory", "Current state directory")}</dt><dd>${this.activeAgentProfile?.dir ?? html`<span class="muted">${t("bundled.info.unavailable.460b35", "Unavailable")}</span>`}</dd></div>
              <div><dt>${t("ui.settingsSessiondPanel.profileStatus", "Profile status")}</dt><dd>${profileActivationLabel(profileActivation)}</dd></div>
              <div><dt>${t("ui.settingsSessiondPanel.spawnedSessions", "Spawned sessions")}</dt><dd>${effectiveSpawn ? t("ui.settingsSessiondPanel.enabled", "Enabled") : html`<span class="muted">${t("ui.settingsShortcutsPanel.disabled", "Disabled")}</span>`}</dd></div>
              <div><dt>${t("ui.settingsSessiondPanel.subsessions", "Subsessions")}</dt><dd>${effectiveSubsessions ? t("ui.settingsSessiondPanel.enabled", "Enabled") : html`<span class="muted">${t("ui.settingsShortcutsPanel.disabled", "Disabled")}</span>`}</dd></div>
              <div><dt>${t("ui.settingsSessiondPanel.agentQuestions", "Agent questions")}</dt><dd>${!askUserSupported ? html`<span class="muted">${t("bundled.info.unavailable.460b35", "Unavailable")}</span>` : effectiveAskUser ? t("ui.settingsSessiondPanel.enabled", "Enabled") : html`<span class="muted">${t("ui.settingsShortcutsPanel.disabled", "Disabled")}</span>`}</dd></div>
            </dl>
          </section>
        `}
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
    return html`<div class="loading-card">${this.loading ? t("ui.settingsSessiondPanel.loadingConfiguration", "Loading configuration…") : t("ui.settingsSessiondPanel.configurationUnavailableReload", "Configuration unavailable. Reload.")}</div>`;
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

  static override styles = [uiButtonStyles, uiFormStyles, uiSettingsStyles, css`
    @layer pi-web-base {
    :host { display: block; }
    h3 { margin: 0; font-size: 13px; line-height: 1.3; }
    .loading-card { color: var(--pi-muted); }
    .config-path-card span, dt { color: var(--pi-muted); font-size: 12px; font-weight: 600; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); overflow-wrap: anywhere; }
    .field small, .effective-card small { color: var(--pi-muted); line-height: 1.45; }
    .naming-model { justify-content: space-between; text-align: start; gap: 12px; }
    #session-naming-model-value { min-width: 0; overflow-wrap: anywhere; }
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
  return t("ui.settingsSessiondPanel.theseSettingsAffectLongLivedSessionRuntimesOn", "These settings affect long-lived session runtimes on {targetLabel}. Changes are saved immediately but take effect only after restarting that machine's session daemon.", { targetLabel: targetLabel });
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

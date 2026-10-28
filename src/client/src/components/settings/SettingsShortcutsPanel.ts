import { localization, LocalizationController } from "../../localization/browser";
import { shortcutMessages as messages } from "./settingsAppearanceMessages";
import { uiSettingsStyles } from "../ui/settingsStyles";
import { uiFormStyles } from "../ui/formStyles";
import { uiButtonStyles } from "../ui/controlStyles";
import { repeat } from "lit/directives/repeat.js";
import { stylesheetIntegrationCapability } from "../../plugins/styles";
import { t } from "../../i18n";
import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import type { AppAction } from "../../actions";
import type { PiWebConfigResponse, PiWebConfigValues, PiWebShortcutConfig } from "../../api";
import { formatShortcut, parseShortcutInput, resolveShortcutBindings, shortcutPreferenceForAction, shortcutSequenceTimeoutMs, shortcutTokenFromEvent, type ShortcutBindingResolution, type ShortcutParseIssue } from "../../keyboardShortcuts";
import { composerShortcutActions, isComposerShortcut } from "../../composerShortcuts";
import { readPromptEnterPreference, writePromptEnterPreference, type PromptEnterPreference } from "../../promptEnterBehavior";
import "./SettingsPanelFrame";
import { enforcedSetting, settingControls, type ResetSettings } from "./settingsConfigUpdate";
import type { SettingsNotice } from "./SettingsPanelFrame";

const RECORD_SHORTCUT_LISTENER_OPTIONS = { capture: true } as const;

function promptEnterOptions(): readonly { value: PromptEnterPreference; label: string; description: string }[] { return [
  {
    value: "auto",
    label: t("ui.settingsShortcutsPanel.autoDefault", "Auto/default"),
    description: t("ui.settingsShortcutsPanel.enterSendsOnDesktopEnterInsertsANewline", "Enter sends on wide screens; Enter inserts a newline when the viewport is at most 760px wide."),
  },
  {
    value: "send",
    label: t("ui.settingsShortcutsPanel.enterSendsMessages", "Enter sends messages"),
    description: t("ui.settingsShortcutsPanel.enterSendsChatMessagesShiftEnterInsertsA", "Enter sends chat messages; Shift+Enter inserts a newline when supported."),
  },
  {
    value: "newline",
    label: t("ui.settingsShortcutsPanel.enterInsertsNewline", "Enter inserts newline"),
    description: t("ui.settingsShortcutsPanel.enterInsertsANewlineShiftEnterSendsChat", "Enter inserts a newline; Shift+Enter sends chat messages when supported."),
  },
]; }

function renderShortcutsDescription(): TemplateResult {
  return html`${messages.rich("description", { code: (parts) => html`<code dir="ltr">${parts}</code>` })}`;
}

@customElement("settings-shortcuts-panel")
export class SettingsShortcutsPanel extends LitElement {
  constructor() {
    super();
    new LocalizationController(this, localization, () => {
      this.localizationPending = true;
    });
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) actions: AppAction[] = [];
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onReset?: ResetSettings;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues) => void | Promise<void>;
  @state() private drafts: Record<string, string> = {};
  @state() private localError: { kind: "parse"; input: string } | { kind: "invalidKey" | "singleChord" } | { kind: "save"; diagnostic: string } | undefined;
  @state() private recording: RecordingState | undefined;
  @state() private promptEnterPreference = readPromptEnterPreference();
  private pendingSaves = new Map<string, { action: AppAction; preference: string | null | undefined; draft: string | undefined }>();
  private localizationPending = false;
  private focusAfterLocalization: HTMLElement | undefined;
  private recordingTimer: number | undefined;
  private recordingListenerActive = false;

  private readonly onRecordKeyDown = (event: KeyboardEvent): void => {
    const recording = this.recording;
    if (recording === undefined) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      this.stopRecording();
      return;
    }

    const token = shortcutTokenFromEvent(event);
    if (token === undefined) {
      this.localError = { kind: "invalidKey" };
      return;
    }
    if (recording.tokens.length > 0 && isComposerShortcut(recording.actionId)) {
      this.localError = { kind: "singleChord" };
      return;
    }

    const tokens = [...recording.tokens, token];
    this.localError = undefined;
    this.drafts = { ...this.drafts, [recording.actionId]: tokens.join(" ") };
    this.recording = { actionId: recording.actionId, tokens };
    if (isComposerShortcut(recording.actionId)) this.stopRecording();
    else this.armRecordingTimer();
  };

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (this.localizationPending) {
      this.localizationPending = false;
      const root = this.getRootNode();
      const focused = "activeElement" in root && root.activeElement === this
        ? this.shadowRoot?.activeElement : null;
      if (focused instanceof HTMLElement) this.focusAfterLocalization = focused;
    }
    if (this.configResponse === undefined || this.loading || this.saving || enforcedSetting(this.configResponse, "/shortcuts") !== undefined) this.stopRecording();
    if (changed.has("configResponse") && this.configResponse !== undefined) {
      for (const [actionId, pending] of this.pendingSaves) {
        if (shortcutPreferenceForAction(pending.action, this.configResponse.config.shortcuts) !== pending.preference) continue;
        if (this.drafts[actionId] === pending.draft) {
          this.drafts = Object.fromEntries(Object.entries(this.drafts).filter(([id]) => id !== actionId));
        }
        this.pendingSaves.delete(actionId);
      }
    }
  }

  protected override updated(): void {
    const focused = this.focusAfterLocalization;
    this.focusAfterLocalization = undefined;
    // Moving keyed groups into translated sort order can blur a retained field.
    // Capture in willUpdate, not on notification, so pending updates cannot steal focus.
    if (focused?.isConnected === true && this.shadowRoot?.activeElement === null) {
      focused.focus({ preventScroll: true });
    }
  }

  override disconnectedCallback(): void {
    this.focusAfterLocalization = undefined;
    this.stopRecording();
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    const groups = shortcutGroups([...composerShortcutActions(undefined, (mobile) => ({
      title: messages.t("composerTitle", { screen: mobile ? "mobile" : "desktop" }),
      description: messages.t("composerDescription"),
    })), ...this.actions]);
    const shortcutResolutions = this.shortcutResolutions();
    return html`
      <settings-panel-frame
        heading=${messages.t("heading")}
        .description=${renderShortcutsDescription()}
        actionLabel=${messages.t("refresh")}
        .actionDisabled=${this.loading}
        .notices=${this.panelNotices()}
        .onAction=${this.onReload}
      >
        ${this.renderPromptEnterPreferenceCard()}
        ${this.configResponse === undefined && this.loading ? html`<div class="loading-card ui-settings-path">${messages.t("loading")}</div>` : html`
          ${this.configResponse === undefined ? html`<div class="loading-card ui-settings-path" role="status">${messages.t("unavailable")}</div>` : null}
          <details class="config-path-card ui-settings-path">
            <summary>${messages.t("details")}</summary>
            <p>${messages.t("editableHelp")}</p>
            <p>${messages.t("screenHelp")}</p>
            <p>${messages.t("priorityHelp")}</p>
            <span>${messages.t("configFile")}</span>
            <code dir="ltr">${this.configResponse?.path ?? messages.t("unknown")}</code>
            <small>${messages.rich("configHelp", { code: (parts) => html`<code dir="ltr">${parts}</code>` })}</small>
          </details>
          <section class="shortcut-group ui-settings-section">
            <div class="ui-settings-heading"><h3>${messages.t("sendBehavior")}</h3></div>
            <label class="shortcut-input-label ui-form-field">
              <span>${messages.t("sendWhileRunning")}</span>
              <select class="ui-select" aria-label=${messages.t("sendWhileRunning")} .value=${live(this.configResponse?.effectiveConfig.defaultStreamingBehavior ?? "steer")} ?disabled=${this.loading || this.saving || this.configResponse === undefined || enforcedSetting(this.configResponse, "/defaultStreamingBehavior") !== undefined} @change=${(event: Event) => { void this.saveSendBehavior(event); }}>
                <option value="steer">${messages.t("steer")}</option>
                <option value="followUp">${messages.t("followUp")}</option>
              </select>
            </label>
            <p>${messages.t("sendHelp")}</p>
            ${settingControls(this.configResponse, "/defaultStreamingBehavior", this.loading || this.saving, this.onReset)}
          </section>
          ${settingControls(this.configResponse, "/shortcuts", this.loading || this.saving, this.onReset)}
          ${groups.length === 0 ? html`<div class="loading-card ui-settings-path">${messages.t("noActions")}</div>` : repeat(groups, (group) => group.id, (group) => html`
            <section class="shortcut-group ui-settings-section">
              <div class="ui-settings-heading"><h3>${group.name}</h3></div>
              <div class="shortcut-list ui-settings-list">
                ${repeat(group.actions, (action) => action.id, (action) => this.renderShortcutRow(action, shortcutResolutions.get(action.id)))}
              </div>
            </section>
          `)}
        `}
      </settings-panel-frame>
    `;
  }

  private async saveSendBehavior(event: Event): Promise<void> {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : undefined;
    if (this.loading || this.saving || this.configResponse === undefined || enforcedSetting(this.configResponse, "/defaultStreamingBehavior") !== undefined || (value !== "steer" && value !== "followUp")) return;
    await this.onSave?.({ defaultStreamingBehavior: value });
  }

  private panelNotices(): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    const local = this.localError;
    const parsed = local?.kind === "parse" ? parseShortcutInput(local.input, presentParseIssue) : undefined;
    const error = local === undefined ? this.error : local.kind === "parse"
      ? parsed?.ok === false ? parsed.message : ""
      : local.kind === "save" ? messages.t("saveFailure", { diagnostic: local.diagnostic }) : messages.t(local.kind);
    if (error !== "") notices.push({ type: "error", content: error });
    if (this.savedMessage !== "") notices.push({ type: "success", content: this.savedMessage });
    return notices;
  }

  private renderPromptEnterPreferenceCard(): TemplateResult {
    return html`
      <section class="prompt-enter-card ui-settings-section" aria-labelledby="prompt-enter-preference-title">
        <div class="prompt-enter-copy ui-settings-heading">
          <span class="card-eyebrow">${t("ui.settingsShortcutsPanel.chatInput", "Chat input")}</span>
          <h3 id="prompt-enter-preference-title">${t("ui.settingsShortcutsPanel.enterKeyBehavior", "Enter key behavior")}</h3>
          <p>${t("ui.settingsShortcutsPanel.chooseEnterBehaviorInThisBrowserShiftEnter", "Choose Enter behavior in this browser. Shift+Enter performs the opposite action when supported; touch-keyboard auto-capitalization is ignored to prevent accidental sends.")}</p>
        </div>
        <div class="prompt-enter-options ui-settings-fields" role="radiogroup" aria-label="${t("ui.settingsShortcutsPanel.enterAndShiftEnterBehaviorInChatInput", "Enter and Shift Enter behavior in chat input")}">
          ${promptEnterOptions().map((option) => html`
            <label class="prompt-enter-option ui-checkbox-field">
              <input
                type="radio"
                name="prompt-enter-preference"
                .value=${option.value}
                .checked=${this.promptEnterPreference === option.value}
                @change=${() => { this.updatePromptEnterPreference(option.value); }}
              >
              <span class="ui-form-field">
                <strong>${option.label}</strong>
                <small>${option.description}</small>
              </span>
            </label>
          `)}
        </div>
      </section>
    `;
  }

  private updatePromptEnterPreference(preference: PromptEnterPreference): void {
    this.promptEnterPreference = preference;
    writePromptEnterPreference(preference);
  }

  private renderShortcutRow(action: AppAction, resolution: ShortcutBindingResolution | undefined): TemplateResult {
    const shortcuts = this.configResponse?.effectiveConfig.shortcuts;
    const configured = shortcutPreferenceForAction(action, shortcuts);
    const state = shortcutState(action, shortcuts);
    const inputText = this.shortcutInputText(action);
    const parsedInput = inputText.trim() === "" ? undefined : parseShortcutInput(inputText);
    const previewShortcut = parsedInput?.ok === true ? parsedInput.shortcut : effectiveShortcut(action, shortcuts);
    const hasConfiguredShortcut = configured !== undefined;
    const hasDraft = this.drafts[action.id] !== undefined;
    const displayState = hasDraft && inputText.trim() !== "" ? "custom" : state;
    const recordingHint = this.recordingHint(action.id);
    const conflictLabel = shortcutConflictLabel(resolution);
    const controlsDisabled = this.loading || this.saving || this.configResponse === undefined || enforcedSetting(this.configResponse, "/shortcuts") !== undefined;
    return html`
      <article class=${`ui-settings-row ${shortcutRowClass(resolution)}`}>
        <div class="shortcut-main">
          <strong dir="auto">${action.title}</strong>
          ${action.description !== undefined && action.description !== "" ? html`<small dir="auto">${action.description}</small>` : null}
          <small class="shortcut-id" dir="ltr">${action.id}</small>
          <small>${action.shortcut !== undefined && action.shortcut !== "" ? messages.rich("defaultShortcut", { shortcut: formatShortcut(action.shortcut), key: (parts) => html`<kbd dir="ltr">${parts}</kbd>` }) : messages.t("noDefaultShortcut")}</small>
        </div>
        <div class="shortcut-editor">
          <div class="shortcut-status">
            ${previewShortcut !== undefined && previewShortcut !== "" ? html`<kbd dir="ltr">${formatShortcut(previewShortcut)}</kbd>` : html`<span class="unassigned">${messages.t(state === "disabled" ? "disabled" : "unassigned")}</span>`}
            <small class=${displayState}>${messages.t("state", { state: displayState, unsaved: hasDraft ? "yes" : "no" })}</small>
            ${conflictLabel === undefined ? null : html`<small class=${shortcutConflictClass(resolution)}>${conflictLabel}</small>`}
          </div>
          <label class="shortcut-input-label ui-form-field">
            <span>${messages.t("shortcut")}</span>
            <input
              class="shortcut-input ui-input"
              dir="ltr"
              data-action-id=${action.id}
              aria-label=${messages.t("shortcutFor", { title: action.title })}
              aria-describedby=${recordingHint !== "" ? `recording-${action.id}` : nothing}
              .value=${inputText}
              placeholder=${action.shortcut ?? "mod+k"}
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              ?disabled=${controlsDisabled}
              @input=${(event: Event) => { this.updateDraft(action.id, inputValue(event)); }}
            >
          </label>
          ${recordingHint !== "" ? html`<small class="recording-hint" id=${`recording-${action.id}`} role="status">${recordingHint}</small>` : null}
          <div class="shortcut-actions ui-settings-actions">
            <button class="primary ui-button ui-button--action ui-button--primary" aria-label=${messages.t("saveFor", { title: action.title })} ?disabled=${controlsDisabled || !hasDraft || inputText.trim() === ""} @click=${() => { void this.saveShortcut(action); }}>${messages.t("save")}</button>
            <button class="ui-button ui-button--action" aria-label=${messages.t("recordFor", { title: action.title, recording: this.recording?.actionId === action.id ? "yes" : "no" })} ?disabled=${controlsDisabled} @click=${() => { void this.toggleRecording(action.id); }}>${messages.t(this.recording?.actionId === action.id ? "cancelRecording" : "record")}</button>
            <button class="ui-button ui-button--action" aria-label=${messages.t("disableFor", { title: action.title })} ?disabled=${controlsDisabled || configured === null} @click=${() => { void this.setShortcutNone(action); }}>${messages.t("disable")}</button>
            <button class="ui-button ui-button--action" aria-label=${messages.t("restoreFor", { title: action.title })} ?disabled=${controlsDisabled || !hasConfiguredShortcut} @click=${() => { void this.resetShortcut(action); }}>${messages.t("restore")}</button>
          </div>
        </div>
      </article>
    `;
  }

  private shortcutInputText(action: AppAction): string {
    const draft = this.drafts[action.id];
    if (draft !== undefined && enforcedSetting(this.configResponse, "/shortcuts") === undefined) return draft;
    const configured = shortcutPreferenceForAction(action, this.configResponse?.effectiveConfig.shortcuts);
    if (configured === null) return "";
    return configured ?? action.shortcut ?? "";
  }

  private recordingHint(actionId: string): string {
    const recording = this.recording;
    if (recording?.actionId !== actionId) return "";
    if (recording.tokens.length === 0) return messages.t("recording");
    return messages.t("recordingSequence", { shortcut: formatShortcut(recording.tokens.join(" ")) });
  }

  private updateDraft(actionId: string, value: string): void {
    this.drafts = { ...this.drafts, [actionId]: value };
    this.localError = undefined;
  }

  private async saveShortcut(action: AppAction): Promise<void> {
    this.stopRecording();
    const input = this.shortcutInputText(action).trim();
    const parsed = parseShortcutInput(input);
    if (!parsed.ok) {
      this.localError = { kind: "parse", input };
      return;
    }
    if (isComposerShortcut(action.id) && parsed.tokens.length !== 1) {
      this.localError = { kind: "singleChord" };
      return;
    }
    this.localError = undefined;
    await this.saveShortcutPreference(action, parsed.shortcut);
  }

  private async setShortcutNone(action: AppAction): Promise<void> {
    this.stopRecording();
    this.localError = undefined;
    await this.saveShortcutPreference(action, null);
  }

  private async resetShortcut(action: AppAction): Promise<void> {
    this.stopRecording();
    this.localError = undefined;
    await this.saveShortcutPreference(action, undefined);
  }

  private async saveShortcutPreference(action: AppAction, shortcut: string | null | undefined): Promise<void> {
    if (this.configResponse === undefined || this.onSave === undefined || enforcedSetting(this.configResponse, "/shortcuts") !== undefined) return;
    const config: PiWebConfigValues = this.configResponse.effectiveConfig.shortcuts === undefined ? {} : { shortcuts: this.configResponse.effectiveConfig.shortcuts };
    const currentShortcuts = config.shortcuts ?? {};
    const shortcuts = withoutShortcutPreferences(currentShortcuts, [action.id, ...action.shortcutAliases ?? []]);
    if (shortcut !== undefined) shortcuts[action.id] = shortcut;
    if (Object.keys(shortcuts).length === 0) {
      config.shortcuts = {};
    } else {
      config.shortcuts = shortcuts;
    }
    const pending = { action, preference: shortcut, draft: this.drafts[action.id] };
    this.pendingSaves.set(action.id, pending);
    try {
      // A resolved callback is not acknowledgement: the owner may catch save errors.
      // Clear the draft only when the returned config contains this preference.
      await this.onSave(config);
      this.requestUpdate();
    } catch (error) {
      if (this.pendingSaves.get(action.id) === pending) this.pendingSaves.delete(action.id);
      this.localError = { kind: "save", diagnostic: error instanceof Error ? error.message : String(error) };
    }
  }

  private shortcutResolutions(): Map<string, ShortcutBindingResolution> {
    const shortcuts = this.previewShortcutConfig();
    const resolutions = [
      ...resolveShortcutBindings(this.actions.filter((action) => !isComposerShortcut(action.id)), shortcuts, { enabledOnly: true }),
      ...composerShortcutActions().flatMap((action) => resolveShortcutBindings([action], shortcuts)),
    ];
    return new Map(resolutions.map((resolution) => [resolution.action.id, resolution]));
  }

  private previewShortcutConfig(): PiWebShortcutConfig | undefined {
    const shortcuts = { ...(this.configResponse?.effectiveConfig.shortcuts ?? {}) };
    for (const [actionId, draft] of Object.entries(enforcedSetting(this.configResponse, "/shortcuts") !== undefined ? {} : this.drafts)) {
      const trimmedDraft = draft.trim();
      if (trimmedDraft === "") continue;
      const parsed = parseShortcutInput(trimmedDraft);
      if (parsed.ok) shortcuts[actionId] = parsed.shortcut;
    }
    return Object.keys(shortcuts).length === 0 ? undefined : shortcuts;
  }

  private async toggleRecording(actionId: string): Promise<void> {
    if (this.recording?.actionId === actionId) {
      this.stopRecording();
      return;
    }
    this.stopRecording();
    this.localError = undefined;
    this.recording = { actionId, tokens: [] };
    this.ensureRecordingListener();
    await this.updateComplete;
    this.focusShortcutInput(actionId);
  }

  private focusShortcutInput(actionId: string): void {
    for (const input of this.renderRoot.querySelectorAll<HTMLInputElement>(".shortcut-input")) {
      if (input.dataset["actionId"] === actionId) {
        input.focus();
        input.select();
        return;
      }
    }
  }

  private armRecordingTimer(): void {
    this.clearRecordingTimer();
    this.recordingTimer = window.setTimeout(() => {
      this.recordingTimer = undefined;
      this.stopRecording();
    }, shortcutSequenceTimeoutMs);
  }

  private stopRecording(): void {
    this.clearRecordingTimer();
    this.removeRecordingListener();
    this.recording = undefined;
  }

  private clearRecordingTimer(): void {
    if (this.recordingTimer === undefined) return;
    window.clearTimeout(this.recordingTimer);
    this.recordingTimer = undefined;
  }

  private ensureRecordingListener(): void {
    if (this.recordingListenerActive) return;
    window.addEventListener("keydown", this.onRecordKeyDown, RECORD_SHORTCUT_LISTENER_OPTIONS);
    this.recordingListenerActive = true;
  }

  private removeRecordingListener(): void {
    if (!this.recordingListenerActive) return;
    window.removeEventListener("keydown", this.onRecordKeyDown, RECORD_SHORTCUT_LISTENER_OPTIONS);
    this.recordingListenerActive = false;
  }

  static override styles = [uiButtonStyles, uiFormStyles, uiSettingsStyles, css`
    @layer pi-web-base {
    :host { display: block; }
    h3, p { margin: 0; }
    p { color: var(--pi-muted); line-height: 1.45; }
    .config-path-card span { color: var(--pi-muted); font-size: 12px; font-weight: 600; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); overflow-wrap: anywhere; }
    .shortcut-group { margin: 0; }
    .shortcut-group:has(.shortcut-list) { padding: 0; gap: 0; }
    .shortcut-group:has(.shortcut-list) > .ui-settings-heading { padding: 16px; background: var(--pi-surface); }
    .shortcut-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 48%); align-items: start; }
    .shortcut-row.shadowed { background: color-mix(in srgb, var(--pi-warning) 5%, var(--pi-surface)); }
    .shortcut-row.shadowing { background: color-mix(in srgb, var(--pi-accent) 5%, var(--pi-surface)); }
    .shortcut-row:last-child { border-bottom: 0; }
    .shortcut-main { min-width: 0; display: grid; gap: 4px; }
    .shortcut-main strong, .shortcut-main small { overflow-wrap: anywhere; }
    .shortcut-main small { color: var(--pi-muted); }
    .shortcut-id { font-family: var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    .shortcut-editor { min-width: 0; display: grid; gap: 8px; }
    .shortcut-status { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .shortcut-status small { color: var(--pi-muted); font-size: 11px; }
    .shortcut-status small.custom { color: var(--pi-accent); }
    .shortcut-status small.disabled { color: var(--pi-warning); }
    .shortcut-status small.conflict.shadowing { color: var(--pi-accent); }
    .shortcut-status small.conflict.shadowed { color: var(--pi-warning); }
    .shortcut-input { --ui-input-font-family: var(--pi-control-monospace-font-family, var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)); }
    kbd { border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-bg); color: var(--pi-text-secondary); padding: 3px 7px; font: 12px var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); white-space: nowrap; }
    .unassigned { color: var(--pi-muted); font-size: 12px; }
    .recording-hint { color: var(--pi-accent); font-size: 12px; }

    @media (max-width: 760px) {
      .shortcut-row { grid-template-columns: minmax(0, 1fr); align-items: start; }
      .shortcut-status, .shortcut-actions { justify-content: flex-start; }
    }

    }
  `];
}

interface RecordingState {
  actionId: string;
  tokens: string[];
}

type ShortcutState = "default" | "custom" | "disabled" | "unassigned";

function shortcutRowClass(resolution: ShortcutBindingResolution | undefined): string {
  if (resolution?.active === false) return "shortcut-row shadowed";
  if (resolution?.active === true && resolution.shadows.length > 0) return "shortcut-row shadowing";
  return "shortcut-row";
}

function shortcutConflictClass(resolution: ShortcutBindingResolution | undefined): string {
  return resolution?.active === false ? "conflict shadowed" : "conflict shadowing";
}

function shortcutConflictLabel(resolution: ShortcutBindingResolution | undefined): string | undefined {
  if (resolution === undefined) return undefined;
  if (!resolution.active) return messages.t("inactive", { title: resolution.shadowedBy?.action.title ?? messages.t("anotherAction") });
  const count = resolution.shadows.length;
  if (count === 0) return undefined;
  return messages.t("conflict", {
    count,
    names: localization.list(resolution.shadows.slice(0, 2).map((binding) => binding.action.title)),
    more: Math.max(0, count - 2),
  });
}

function shortcutGroups(actions: AppAction[]): { id: string; name: string; actions: AppAction[] }[] {
  const grouped = new Map<string, { id: string; name: string; actions: AppAction[] }>();
  for (const action of actions) {
    const composer = isComposerShortcut(action.id);
    const id = composer ? "composer" : JSON.stringify([action.group ?? null]);
    const group = grouped.get(id) ?? {
      id,
      name: composer ? messages.t("composerGroup") : action.group ?? messages.t("otherGroup"),
      actions: [],
    };
    group.actions.push(action);
    grouped.set(id, group);
  }
  // Stable keys keep focused fields and recording state attached to action identity
  // when translated titles change the visible sort order.
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, localization.language)).map((group) => ({
    ...group, actions: group.actions.sort((a, b) => a.title.localeCompare(b.title, localization.language)),
  }));
}

function withoutShortcutPreferences(shortcuts: PiWebShortcutConfig, actionIds: readonly string[]): PiWebShortcutConfig {
  const removed = new Set(actionIds);
  return Object.fromEntries(Object.entries(shortcuts).filter(([shortcutActionId]) => !removed.has(shortcutActionId)));
}

function effectiveShortcut(action: AppAction, shortcuts: PiWebShortcutConfig | undefined): string | undefined {
  const configured = shortcutPreferenceForAction(action, shortcuts);
  if (configured === null) return undefined;
  return configured ?? action.shortcut;
}

function shortcutState(action: AppAction, shortcuts: PiWebShortcutConfig | undefined): ShortcutState {
  const configured = shortcutPreferenceForAction(action, shortcuts);
  if (configured === null) return "disabled";
  if (configured !== undefined) return "custom";
  return action.shortcut === undefined || action.shortcut === "" ? "unassigned" : "default";
}

function presentParseIssue(issue: ShortcutParseIssue): string {
  return "value" in issue ? messages.t(issue.kind, { value: issue.value }) : messages.t(issue.kind);
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

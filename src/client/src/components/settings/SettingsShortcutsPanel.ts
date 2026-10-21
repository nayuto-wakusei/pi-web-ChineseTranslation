import { uiSettingsStyles } from "../ui/settingsStyles";
import { uiFormStyles } from "../ui/formStyles";
import { uiButtonStyles } from "../ui/controlStyles";
import { stylesheetIntegrationCapability } from "../../plugins/styles";
import { t } from "../../i18n";
import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppAction } from "../../actions";
import type { PiWebConfigResponse, PiWebConfigValues, PiWebShortcutConfig } from "../../api";
import { composerShortcutActions, isComposerShortcut } from "../../composerShortcuts";
import { shortcutPreferenceForAction } from "../../keyboardShortcuts";
import { formatShortcut, parseShortcutInput, resolveShortcutBindings, shortcutSequenceTimeoutMs, shortcutTokenFromEvent, type ShortcutBindingResolution } from "../../keyboardShortcuts";
import { readPromptEnterPreference, writePromptEnterPreference, type PromptEnterPreference } from "../../promptEnterBehavior";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";

const RECORD_SHORTCUT_LISTENER_OPTIONS = { capture: true } as const;

const PROMPT_ENTER_OPTIONS: readonly { value: PromptEnterPreference; label: string; description: string }[] = [
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
];

function renderShortcutsDescription(): TemplateResult {
  return html`${t("ui.main.29da83a15958", "Edit app shortcuts by action. Type a shortcut such as")} <code>mod+k</code> ${t("ui.settingsShortcutsPanel.or", " or ")} <code>mod+g p</code>${t("ui.main.1c1a5ce1b6d2", ", record one from the keyboard, disable it with None, or reset it to the default. Unmodified app shortcuts work outside editable fields. Composer send bindings accept one key combination and take priority inside the editor; unassigned Enter and Shift+Enter insert newlines. Narrow screen applies when the viewport is at most 760px wide; otherwise, desktop applies regardless of pointer type. When app shortcuts conflict, custom shortcuts win before defaults; ties are resolved by action id, and shorter shortcuts shadow longer sequences with the same prefix.")}`;
}

@customElement("settings-shortcuts-panel")
export class SettingsShortcutsPanel extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) actions: AppAction[] = [];
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues) => void | Promise<void>;
  @state() private drafts: Record<string, string> = {};
  @state() private localError = "";
  @state() private promptEnterPreference: PromptEnterPreference = readPromptEnterPreference();
  @state() private recording: RecordingState | undefined;
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
      this.localError = t("ui.settingsShortcutsPanel.pressALetterNumberPunctuationFunctionOrNavigation", "Press a letter, number, punctuation, function, or navigation key. Press Esc to cancel recording.");
      return;
    }
    if (recording.tokens.length > 0 && isComposerShortcut(recording.actionId)) {
      this.localError = t("ui.main.e5fcfdb23aec", "The send shortcut must be a single key combination, not a sequence.");
      return;
    }

    const tokens = [...recording.tokens, token];
    this.localError = "";
    this.drafts = { [recording.actionId]: tokens.join(" ") };
    this.recording = { actionId: recording.actionId, tokens };
    if (isComposerShortcut(recording.actionId)) this.stopRecording();
    else this.armRecordingTimer();
  };

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("configResponse") && this.configResponse !== undefined) {
      this.drafts = {};
      this.localError = "";
      this.stopRecording();
    }
  }

  override disconnectedCallback(): void {
    this.stopRecording();
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    const groups = shortcutGroups([...composerShortcutActions(), ...this.actions]);
    const shortcutResolutions = this.shortcutResolutions();
    return html`
      <settings-panel-frame
        heading="${t("ui.settingsShortcutsPanel.keyboardShortcuts", "Keyboard shortcuts")}"
        .description=${renderShortcutsDescription()}
        actionLabel="${t("ui.settingsPackagesPanel.reload", "Reload")}"
        .actionDisabled=${this.loading}
        .notices=${this.panelNotices()}
        .onAction=${this.onReload}
      >
        ${this.renderPromptEnterPreferenceCard()}
        ${this.configResponse === undefined && this.loading ? html`<div class="loading-card">${t("ui.settingsShortcutsPanel.loadingShortcuts", "Loading shortcuts…")}</div>` : html`
          <div class="config-path-card ui-settings-path">
            <span>${t("ui.settingsShortcutsPanel.configurationFile", "Configuration file")}</span>
            <code>${this.configResponse?.path ?? t("bundled.updates.unknown.4d8c1c", "Unknown")}</code>
            <small>${t("ui.settingsShortcutsPanel.shortcutOverridesAreSavedUnder", "Shortcut overrides are saved under ")} <code>shortcuts</code> ${t("ui.settingsShortcutsPanel.aValueOf", ". A value of ")} <code>null</code> ${t("ui.settingsShortcutsPanel.disablesTheActionShortcut", " disables the action shortcut.")}</small>
          </div>
          ${groups.length === 0 ? html`<div class="loading-card">${t("ui.settingsShortcutsPanel.noRegisteredActions", "No registered actions.")}</div>` : groups.map((group) => html`
            <section class="shortcut-group">
              <h3>${group.name}</h3>
              <div class="shortcut-list">
                ${group.actions.map((action) => this.renderShortcutRow(action, shortcutResolutions.get(action.id)))}
              </div>
            </section>
          `)}
        `}
      </settings-panel-frame>
    `;
  }

  private panelNotices(): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    const error = this.localError || this.error;
    if (error !== "") notices.push({ type: "error", content: error });
    if (this.savedMessage !== "") notices.push({ type: "success", content: this.savedMessage });
    return notices;
  }

  private renderPromptEnterPreferenceCard(): TemplateResult {
    return html`
      <section class="prompt-enter-card" aria-labelledby="prompt-enter-preference-title">
        <div class="prompt-enter-copy">
          <span class="card-eyebrow">${t("ui.settingsShortcutsPanel.chatInput", "Chat input")}</span>
          <h3 id="prompt-enter-preference-title">${t("ui.settingsShortcutsPanel.enterKeyBehavior", "Enter key behavior")}</h3>
          <p>${t("ui.settingsShortcutsPanel.chooseEnterBehaviorInThisBrowserShiftEnter", "Choose Enter behavior in this browser. Shift+Enter performs the opposite action when supported; touch-keyboard auto-capitalization is ignored to prevent accidental sends.")}</p>
        </div>
        <div class="prompt-enter-options" role="radiogroup" aria-label="${t("ui.settingsShortcutsPanel.enterAndShiftEnterBehaviorInChatInput", "Enter and Shift Enter behavior in chat input")}">
          ${PROMPT_ENTER_OPTIONS.map((option) => html`
            <label class="prompt-enter-option">
              <input
                type="radio"
                name="prompt-enter-preference"
                .value=${option.value}
                .checked=${this.promptEnterPreference === option.value}
                @change=${() => { this.updatePromptEnterPreference(option.value); }}
              >
              <span>
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
    const shortcuts = this.configResponse?.config.shortcuts;
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
    return html`
      <article class=${shortcutRowClass(resolution)}>
        <div class="shortcut-main">
          <strong>${action.title}</strong>
          ${action.description !== undefined && action.description !== "" ? html`<small>${action.description}</small>` : null}
          <small class="shortcut-id">${action.id}</small>
          <small>${action.shortcut !== undefined && action.shortcut !== "" ? html`${t("ui.settingsShortcutsPanel.default2", "Default:")}<kbd>${formatShortcut(action.shortcut)}</kbd>` : t("ui.settingsShortcutsPanel.noDefaultShortcut", "No default shortcut")}</small>
        </div>
        <div class="shortcut-editor">
          <div class="shortcut-status">
            ${previewShortcut !== undefined && previewShortcut !== "" ? html`<kbd>${formatShortcut(previewShortcut)}</kbd>` : html`<span class="unassigned">${state === "disabled" ? t("ui.settingsShortcutsPanel.disabled", "Disabled") : t("ui.settingsShortcutsPanel.unassigned", "Unassigned")}</span>`}
            <small class=${displayState}>${shortcutStateLabel(displayState)}${hasDraft ? t("ui.settingsShortcutsPanel.unsaved", " · Unsaved") : ""}</small>
            ${conflictLabel === undefined ? null : html`<small class=${shortcutConflictClass(resolution)}>${conflictLabel}</small>`}
          </div>
          <label class="shortcut-input-label">
            <span>${t("ui.settingsShortcutsPanel.shortcut", "Shortcut")}</span>
            <input
              class="shortcut-input"
              data-action-id=${action.id}
              .value=${inputText}
              placeholder=${action.shortcut ?? "mod+k"}
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              ?disabled=${this.saving}
              @input=${(event: Event) => { this.updateDraft(action.id, inputValue(event)); }}
            >
          </label>
          ${recordingHint !== "" ? html`<small class="recording-hint">${recordingHint}</small>` : null}
          <div class="shortcut-actions ui-settings-actions">
            <button class="primary ui-button ui-button--action ui-button--primary" ?disabled=${this.loading || this.saving || !hasDraft || inputText.trim() === ""} @click=${() => { void this.saveShortcut(action); }}>${t("ui.settingsShortcutsPanel.save", "Save")}</button>
            <button ?disabled=${this.loading || this.saving} @click=${() => { void this.toggleRecording(action.id); }}>${this.recording?.actionId === action.id ? t("ui.settingsShortcutsPanel.cancelRecording", "Cancel recording") : t("ui.settingsShortcutsPanel.record", "Record")}</button>
            <button ?disabled=${this.loading || this.saving || configured === null} @click=${() => { void this.setShortcutNone(action); }}>${t("ui.settingsShortcutsPanel.none", "None")}</button>
            <button ?disabled=${this.loading || this.saving || !hasConfiguredShortcut} @click=${() => { void this.resetShortcut(action); }}>${t("ui.settingsShortcutsPanel.reset", "Reset")}</button>
          </div>
        </div>
      </article>
    `;
  }

  private shortcutInputText(action: AppAction): string {
    const draft = this.drafts[action.id];
    if (draft !== undefined) return draft;
    const configured = shortcutPreferenceForAction(action, this.configResponse?.config.shortcuts);
    if (configured === null) return "";
    return configured ?? action.shortcut ?? "";
  }

  private recordingHint(actionId: string): string {
    const recording = this.recording;
    if (recording?.actionId !== actionId) return "";
    if (recording.tokens.length === 0) return t("ui.settingsShortcutsPanel.recordingPressCtrlOrAltPlusAKey", "Recording: press Ctrl/⌘ or Alt plus a key. Press Esc to cancel.");
    return t("ui.settingsShortcutsPanel.recordingPressMoreKeysToAddASequence", "Recording: {join}. Press more keys to add a sequence, or wait to finish.", { join: formatShortcut(recording.tokens.join(" ")) });
  }

  private updateDraft(actionId: string, value: string): void {
    this.drafts = { [actionId]: value };
    this.localError = "";
  }

  private async saveShortcut(action: AppAction): Promise<void> {
    this.stopRecording();
    const input = this.shortcutInputText(action).trim();
    const parsed = parseShortcutInput(input);
    if (!parsed.ok) {
      this.localError = parsed.message;
      return;
    }
    if (isComposerShortcut(action.id) && parsed.tokens.length !== 1) {
      this.localError = t("ui.main.3c6a5ae4d855", "Composer send shortcuts must be a single key combination, not a sequence.");
      return;
    }
    this.localError = "";
    await this.saveShortcutPreference(action, parsed.shortcut);
  }

  private async setShortcutNone(action: AppAction): Promise<void> {
    this.stopRecording();
    this.localError = "";
    await this.saveShortcutPreference(action, null);
  }

  private async resetShortcut(action: AppAction): Promise<void> {
    this.stopRecording();
    this.localError = "";
    await this.saveShortcutPreference(action, undefined);
  }

  private async saveShortcutPreference(action: AppAction, shortcut: string | null | undefined): Promise<void> {
    const config: PiWebConfigValues = { ...(this.configResponse?.config ?? {}) };
    const currentShortcuts = config.shortcuts ?? {};
    const shortcuts = withoutShortcutPreferences(currentShortcuts, [action.id, ...action.shortcutAliases ?? []]);
    if (shortcut !== undefined) shortcuts[action.id] = shortcut;
    if (Object.keys(shortcuts).length === 0) {
      delete config.shortcuts;
    } else {
      config.shortcuts = shortcuts;
    }
    await this.onSave?.(config);
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
    const shortcuts = { ...(this.configResponse?.config.shortcuts ?? {}) };
    for (const [actionId, draft] of Object.entries(this.drafts)) {
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
    this.localError = "";
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
  if (!resolution.active) return t("ui.settingsShortcutsPanel.shadowedBy", "Shadowed by \"{title}\"", { title: resolution.shadowedBy?.action.title ?? t("ui.settingsShortcutsPanel.anotherAction", "another action") });
  const shadowedCount = resolution.shadows.length;
  if (shadowedCount === 0) return undefined;
  const shadowedNames = resolution.shadows.slice(0, 2).map((binding) => binding.action.title).join(", ");
  const suffix = shadowedCount > 2 ? t("ui.settingsShortcutsPanel.plusMore", ", plus {shadowedCount2} more", { shadowedCount2: String(shadowedCount - 2) }) : "";
  return t("ui.settingsShortcutsPanel.shadowsActions", "Shadows {shadowedCount} actions: {shadowedNames}{suffix}", { shadowedCount: String(shadowedCount), shadowedNames: shadowedNames, suffix: suffix });
}

function shortcutGroups(actions: AppAction[]): { name: string; actions: AppAction[] }[] {
  const grouped = new Map<string, AppAction[]>();
  for (const action of [...actions].sort(compareActions)) {
    const group = action.group ?? t("ui.settingsShortcutsPanel.other", "Other");
    grouped.set(group, [...(grouped.get(group) ?? []), action]);
  }
  return [...grouped.entries()].map(([name, groupActions]) => ({ name, actions: groupActions }));
}

function compareActions(left: AppAction, right: AppAction): number {
  return (left.group ?? t("ui.settingsShortcutsPanel.other", "Other")).localeCompare(right.group ?? t("ui.settingsShortcutsPanel.other", "Other")) || left.title.localeCompare(right.title);
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

function shortcutStateLabel(state: ShortcutState): string {
  switch (state) {
    case "default": return t("ui.settingsShortcutsPanel.default", "Default");
    case "custom": return t("ui.settingsShortcutsPanel.configurationOverride", "Configuration override");
    case "disabled": return t("ui.settingsShortcutsPanel.disabledInConfiguration", "Disabled in configuration");
    case "unassigned": return t("ui.settingsShortcutsPanel.noDefault", "No default");
  }
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

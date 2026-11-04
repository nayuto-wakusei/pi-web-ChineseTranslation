import { live } from "lit/directives/live.js";
import { LocalizationController, localization } from "../../localization/browser";
import source from "./settingsSpeech.messages";

import { enforcedSetting, explicitConfigUpdate, type ResetSettings } from "./settingsConfigUpdate";
import { uiSettingsStyles } from "../ui/settingsStyles";
import { uiButtonStyles } from "../ui/controlStyles";
import { uiFormStyles } from "../ui/formStyles";
import { stylesheetIntegrationCapability } from "../../plugins/styles";
import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";

export const speechMessages = localization.registerMessages("core.settingsSpeech", source);

type SpeechApi = "transcriptions" | "chat";

export interface SpeechSettingsDraft {
  endpoint: string;
  api: SpeechApi;
  model: string;
  language: string;
  apiKeyEnv: string;
}

const SPEECH_DRAFT_KEYS = ["endpoint", "api", "model", "language", "apiKeyEnv"] as const;

export function emptySpeechSettingsDraft(): SpeechSettingsDraft {
  return { endpoint: "", api: "transcriptions", model: "", language: "", apiKeyEnv: "" };
}

export function speechSettingsDraftFromConfig(speech: PiWebConfigValues["speech"]): SpeechSettingsDraft {
  return {
    endpoint: speech?.endpoint ?? "",
    api: speech?.api ?? "transcriptions",
    model: speech?.model ?? "",
    language: speech?.language ?? "",
    apiKeyEnv: speech?.apiKeyEnv ?? "",
  };
}

export function speechSettingsDraftMatchesConfig(draft: SpeechSettingsDraft, speech: PiWebConfigValues["speech"]): boolean {
  const saved = speechSettingsDraftFromConfig(speech);
  return SPEECH_DRAFT_KEYS.every((key) => draft[key] === saved[key]);
}

/**
 * Draft values map back to the config namespace. Defaults are omitted so a save
 * does not persist values the user never changed; clearing a saved leaf becomes
 * an explicit unset instead.
 */
export function speechConfigFromDraft(draft: SpeechSettingsDraft): PiWebConfigValues {
  const endpoint = draft.endpoint.trim();
  const model = draft.model.trim();
  const language = draft.language.trim();
  const apiKeyEnv = draft.apiKeyEnv.trim();
  return {
    speech: {
      ...(endpoint === "" ? {} : { endpoint }),
      ...(draft.api === "transcriptions" ? {} : { api: draft.api }),
      ...(model === "" ? {} : { model }),
      ...(language === "" ? {} : { language }),
      ...(apiKeyEnv === "" ? {} : { apiKeyEnv }),
    },
  };
}

export function speechConfigUnsetPaths(draft: SpeechSettingsDraft, saved: PiWebConfigValues["speech"]): string[] {
  const candidate = speechConfigFromDraft(draft).speech ?? {};
  return SPEECH_DRAFT_KEYS
    .filter((key) => saved?.[key] !== undefined && candidate[key] === undefined)
    .map((key) => `/speech/${key}`);
}

export function speechConfigValidationError(draft: SpeechSettingsDraft): string {
  const endpoint = draft.endpoint.trim();
  if (endpoint !== "" && !isAbsoluteHttpUrl(endpoint)) return speechMessages.t("endpointInvalid");
  const language = draft.language.trim();
  if (language !== "" && !/^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$/u.test(language)) return speechMessages.t("languageInvalid");
  const apiKeyEnv = draft.apiKeyEnv.trim();
  if (apiKeyEnv !== "" && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(apiKeyEnv)) return speechMessages.t("apiKeyEnvInvalid");
  return "";
}

function isAbsoluteHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
}

@customElement("settings-speech-panel")
export class SettingsSpeechPanel extends LitElement {
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
  @property() targetId = "local";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues, unset?: string[]) => void | Promise<void>;
  @property({ attribute: false }) onReset?: ResetSettings;
  @state() private draft: SpeechSettingsDraft = emptySpeechSettingsDraft();
  @state() private draftDirty = false;
  @state() private localError = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("targetId")) {
      this.draft = emptySpeechSettingsDraft();
      this.draftDirty = false;
      this.localError = "";
    }
    if (!changed.has("configResponse")) return;
    if (this.configResponse === undefined) {
      this.draft = emptySpeechSettingsDraft();
      this.draftDirty = false;
      this.localError = "";
      return;
    }
    if (!this.draftDirty || speechSettingsDraftMatchesConfig(this.draft, this.configResponse.config.speech)) {
      this.draft = speechSettingsDraftFromConfig(this.configResponse.config.speech);
      this.draftDirty = false;
      this.localError = "";
    }
  }

  override render(): TemplateResult {
    const response = this.configResponse;
    const configured = response?.effectiveConfig.speech?.endpoint !== undefined;
    return html`
      <settings-panel-frame
        .heading=${speechMessages.t("heading")}
        .description=${speechMessages.t("description")}
        .actionLabel=${speechMessages.t("refresh")}
        .actionDisabled=${this.loading || this.saving}
        .notices=${this.panelNotices(configured)}
        .onAction=${this.onReload}
      >
        <section class="ui-settings-section">
          ${response === undefined
            ? html`<div class="loading-card">${speechMessages.t(this.loading ? "loading" : "unavailable")}</div>`
            : html`
              <div class="config-path-card ui-settings-path">
                <span>${speechMessages.t("configFile")}</span>
                <code dir="ltr">${response.path}</code>
              </div>
              <form class="profile-form ui-settings-fields" aria-label=${speechMessages.t("heading")} @submit=${(event: Event) => { void this.save(event); }}>
                <label class="field ui-form-field">
                  <span class="field-heading">
                    <span>${speechMessages.t("endpointLabel")}</span>
                    ${this.enforced("/speech/endpoint") === undefined ? null : html`<span class="override-badge">${this.enforced("/speech/endpoint")}</span>`}
                  </span>
                  <input
                    id="speech-endpoint"
                    class="text-input ui-input"
                    type="url"
                    inputmode="url"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="http://192.168.2.162:8080"
                    .value=${live(this.draft.endpoint)}
                    ?disabled=${this.busy || this.enforced("/speech/endpoint") !== undefined}
                    @input=${(event: Event) => { this.updateDraft({ endpoint: inputValue(event) }); }}
                  >
                  <small>${speechMessages.t("endpointHelp")}</small>
                </label>

                <label class="field ui-form-field">
                  <span class="field-heading">
                    <span>${speechMessages.t("apiLabel")}</span>
                    ${this.enforced("/speech/api") === undefined ? null : html`<span class="override-badge">${this.enforced("/speech/api")}</span>`}
                  </span>
                  <select
                    id="speech-api"
                    class="ui-select"
                    .value=${live(this.draft.api)}
                    ?disabled=${this.busy || this.enforced("/speech/api") !== undefined}
                    @change=${(event: Event) => { this.updateDraft({ api: inputValue(event) === "chat" ? "chat" : "transcriptions" }); }}
                  >
                    <option value="transcriptions">${speechMessages.t("apiTranscriptions")}</option>
                    <option value="chat">${speechMessages.t("apiChat")}</option>
                  </select>
                  <small>${speechMessages.t("apiHelp")}</small>
                </label>

                <label class="field ui-form-field">
                  <span class="field-heading">
                    <span>${speechMessages.t("modelLabel")}</span>
                    ${this.enforced("/speech/model") === undefined ? null : html`<span class="override-badge">${this.enforced("/speech/model")}</span>`}
                  </span>
                  <input
                    id="speech-model"
                    class="text-input ui-input"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="qwen3-asr-0.6b"
                    .value=${live(this.draft.model)}
                    ?disabled=${this.busy || this.enforced("/speech/model") !== undefined}
                    @input=${(event: Event) => { this.updateDraft({ model: inputValue(event) }); }}
                  >
                  <small>${speechMessages.t("modelHelp")}</small>
                </label>

                <label class="field ui-form-field">
                  <span class="field-heading">
                    <span>${speechMessages.t("languageLabel")}</span>
                    ${this.enforced("/speech/language") === undefined ? null : html`<span class="override-badge">${this.enforced("/speech/language")}</span>`}
                  </span>
                  <input
                    id="speech-language"
                    class="text-input ui-input"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="zh"
                    .value=${live(this.draft.language)}
                    ?disabled=${this.busy || this.enforced("/speech/language") !== undefined}
                    @input=${(event: Event) => { this.updateDraft({ language: inputValue(event) }); }}
                  >
                  <small>${speechMessages.t("languageHelp")}</small>
                </label>

                <label class="field ui-form-field">
                  <span class="field-heading">
                    <span>${speechMessages.t("apiKeyEnvLabel")}</span>
                    ${this.enforced("/speech/apiKeyEnv") === undefined ? null : html`<span class="override-badge">${this.enforced("/speech/apiKeyEnv")}</span>`}
                  </span>
                  <input
                    id="speech-api-key-env"
                    class="text-input ui-input"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="SPEECH_API_KEY"
                    .value=${live(this.draft.apiKeyEnv)}
                    ?disabled=${this.busy || this.enforced("/speech/apiKeyEnv") !== undefined}
                    @input=${(event: Event) => { this.updateDraft({ apiKeyEnv: inputValue(event) }); }}
                  >
                  <small>${speechMessages.t("apiKeyEnvHelp")}</small>
                </label>

                <p class="field-help"><small>${speechMessages.t("advancedNote")}</small></p>
                ${this.localError === "" ? null : html`<p class="ui-form-error" role="alert">${this.localError}</p>`}
                <div class="ui-form-actions">
                  <button type="submit" class="ui-button ui-button--primary" ?disabled=${this.busy}>${speechMessages.t("save")}</button>
                  <button type="button" class="ui-button" ?disabled=${this.busy || response.config.speech === undefined} @click=${() => { void this.reset(); }}>${speechMessages.t("reset")}</button>
                </div>
              </form>
            `}
        </section>
      </settings-panel-frame>
    `;
  }

  private get busy(): boolean {
    return this.loading || this.saving;
  }

  private enforced(path: string): string | undefined {
    return enforcedSetting(this.configResponse, path);
  }

  private panelNotices(configured: boolean): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    if (this.localError !== "" || this.error !== "") notices.push({ type: "error", content: this.localError || this.error, role: "alert" });
    if (this.savedMessage !== "") notices.push({ type: "success", content: this.savedMessage, role: "status" });
    if ((configured || this.draft.endpoint.trim() !== "") && this.draft.model.trim() === "") {
      notices.push({ type: "warning", content: speechMessages.t("modelRequired"), role: "note" });
    }
    if (configured) notices.push({ type: "info", content: speechMessages.t("restartRequired"), role: "note" });
    if (this.draftDirty) notices.push({ type: "warning", content: speechMessages.t("unsaved"), role: "note" });
    return notices;
  }

  private updateDraft(patch: Partial<SpeechSettingsDraft>): void {
    this.draft = { ...this.draft, ...patch };
    this.draftDirty = true;
    this.localError = "";
  }

  private async save(event: Event): Promise<void> {
    event.preventDefault();
    const response = this.configResponse;
    if (response === undefined || this.busy) return;
    const validation = speechConfigValidationError(this.draft);
    if (validation !== "") {
      this.localError = validation;
      return;
    }
    const saved = response.config.speech;
    const baseline: PiWebConfigValues = saved === undefined ? {} : { speech: saved };
    const candidate = speechConfigFromDraft(this.draft);
    const update = explicitConfigUpdate(response, candidate, baseline);
    const unset = [...(update.unset ?? []), ...speechConfigUnsetPaths(this.draft, saved)];
    this.localError = "";
    await this.onSave?.(update.set ?? {}, unset.length === 0 ? undefined : unset);
  }

  private async reset(): Promise<void> {
    if (this.busy) return;
    this.localError = "";
    await this.onReset?.(["/speech"]);
  }

  static override styles = [uiButtonStyles, uiFormStyles, uiSettingsStyles, css`
    @layer pi-web-base {
    :host { display: block; overflow-wrap: anywhere; }
    .ui-form-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .field-help { margin: 0; color: var(--pi-muted); }
    /* Same local treatment as the general panel: these shared-class names are
       not part of the theme contract, so each owning panel styles them. */
    .config-path-card span, .field-heading { color: var(--pi-muted); font-size: 12px; font-weight: 600; }
    .field-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .override-badge { overflow-wrap: anywhere; border: 1px solid var(--pi-warning-border); border-radius: 999px; color: var(--pi-warning); background: var(--pi-warning-surface); padding: 2px 7px; font-size: 11px; font-weight: 600; text-transform: none; }
    }
  `];
}

function inputValue(event: Event): string {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return event.target.value;
  return "";
}

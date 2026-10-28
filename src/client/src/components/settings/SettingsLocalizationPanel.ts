import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { inheritedLocalizationSetting, localization, LocalizationController } from "../../localization/browser";
import type { LocalizationPreferences } from "../../localization/service";
import { stylesheetIntegrationCapability } from "../../plugins/styles";
import { uiButtonStyles } from "../ui/controlStyles";
import { uiFormStyles } from "../ui/formStyles";
import { uiSettingsStyles } from "../ui/settingsStyles";
import source from "./settingsLocalization.messages";
import type { PiWebConfigResponse } from "../../api";
import { enforcedSetting, settingSource } from "./settingsConfigUpdate";

export const localizationSettingsMessages = localization.registerMessages("core.settingsLocalization", source);
const messages = localizationSettingsMessages;
interface Draft { language: string; formatLocale: string; timeZone: string; hourCycle: string }
type Field = keyof Draft;
interface Validation { field: Field; key: "invalidLanguage" | "invalidRegion" | "invalidZone" | "invalidHours" }
function draftFromPreferences(value: Readonly<Partial<LocalizationPreferences>>): Draft {
  return { language: value.language ?? localization.preferences.language, formatLocale: value.formatLocale ?? "", timeZone: value.timeZone ?? "", hourCycle: value.hourCycle ?? "" };
}
function availableLanguage(requested: string): string {
  const languages = localization.availableLanguages;
  if (languages.includes(requested)) return requested;
  return languages.includes(localization.language) ? localization.language : "en";
}
function clockFormat(draft: Draft): "" | "h12" | "h23" {
  if (!draft.hourCycle) return "";
  // Represent old explicit cycles by their conventional 12/24-hour equivalents.
  return draft.hourCycle === "h11" || draft.hourCycle === "h12" ? "h12" : "h23";
}
function sameDraft(a: Draft, b: Draft): boolean {
  return a.language === b.language && a.formatLocale === b.formatLocale && a.timeZone === b.timeZone && a.hourCycle === b.hourCycle;
}
function validateDraft(draft: Draft): Validation | undefined {
  for (const [field, key] of [["language", "invalidLanguage"], ["formatLocale", "invalidRegion"]] as const) {
    if (field === "formatLocale" && !draft[field].trim()) continue;
    try { if (Intl.getCanonicalLocales(draft[field].trim())[0] === undefined) return { field, key }; }
    catch { return { field, key }; }
  }
  try { new Intl.DateTimeFormat("en", draft.timeZone.trim() ? { timeZone: draft.timeZone.trim() } : {}); }
  catch { return { field: "timeZone", key: "invalidZone" }; }
  if (!["", "h11", "h12", "h23", "h24"].includes(draft.hourCycle)) return { field: "hourCycle", key: "invalidHours" };
  return undefined;
}

/** Browser-owned preferences are independent of gateway/selected-machine config and availability. */
@customElement("settings-localization-panel")
export class SettingsLocalizationPanel extends LitElement {
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;

  private locked(field: Field): boolean {
    return enforcedSetting(this.configResponse, `/defaultLocalization/${field}`) !== undefined || localization.preferenceSettingPolicy(field).locked;
  }

  private fieldSource(field: Field): ReturnType<typeof settingSource> {
    const policy = localization.preferenceSettingPolicy(field);
    return settingSource(enforcedSetting(this.configResponse, `/defaultLocalization/${field}`) ?? policy.enforcedBy,
      this.configResponse?.configSources?.[`/defaultLocalization/${field}`] ?? policy.source);
  }

  private displayedPreferences(): Partial<LocalizationPreferences> {
    const preferences = { ...localization.preferenceOverrides };
    for (const field of ["language", "formatLocale", "timeZone", "hourCycle"] as const) {
      if (this.locked(field)) Object.assign(preferences, { [field]: this.configResponse?.effectiveConfig.defaultLocalization?.[field] ?? localization.preferences[field] });
    }
    return preferences;
  }
  private baseline = draftFromPreferences(localization.preferenceOverrides);
  @state() private draft = { ...this.baseline };
  @state() private validation: Validation | undefined;
  @state() private failure: string | undefined;
  @state() private applying = false;
  @state() private saved = false;
  private readonly previewDate = new Date();

  constructor() {
    super();
    new LocalizationController(this);
    stylesheetIntegrationCapability.createController(this);
  }

  protected override willUpdate(): void {
    const incoming = draftFromPreferences(this.displayedPreferences());
    if (!sameDraft(incoming, this.baseline)) {
      if (sameDraft(this.draft, this.baseline)) this.draft = incoming;
      this.baseline = incoming;
    }
    for (const field of ["language", "formatLocale", "timeZone", "hourCycle"] as const) {
      if (this.locked(field)) this.draft[field] = incoming[field];
    }
  }

  protected override updated(): void {
    // Apply values after options exist, including options added by a live language pack.
    const language = this.renderRoot.querySelector<HTMLSelectElement>("#language");
    const hours = this.renderRoot.querySelector<HTMLSelectElement>("#hourCycle");
    if (language) language.value = availableLanguage(this.draft.language);
    if (hours) hours.value = clockFormat(this.draft);
  }

  override render(): TemplateResult {
    const languages = localization.availableLanguages;
    const selectedLanguage = availableLanguage(this.draft.language);
    const selectedClockFormat = clockFormat(this.draft);
    const regionDefault = inheritedLocalizationSetting("formatLocale");
    const zoneDefault = inheritedLocalizationSetting("timeZone");
    const displayNames = new Intl.DisplayNames([localization.language], { type: "language" });
    return html`
      <section class="ui-settings-section" aria-labelledby="localization-heading">
        <header class="ui-settings-heading">
          <h3 id="localization-heading">${messages.t("heading")}</h3>
          <p>${messages.t("description")}</p>
        </header>
        <form class="ui-settings-fields" novalidate @submit=${(event: Event) => { event.preventDefault(); void this.apply(this.draft); }}>
          <label class="ui-form-field" for="language">
            <span>${messages.t("language")}</span>
            <select id="language" class="ui-input" aria-describedby=${this.helpIds("language", "language-help")} aria-invalid=${this.validation?.field === "language" ? "true" : nothing} ?disabled=${this.applying || this.locked("language")}
              @change=${(event: Event) => { this.edit("language", event); }}>
              ${languages.map((code) => html`<option value=${code} ?selected=${code === selectedLanguage}>${messages.t("languageOption", { name: displayNames.of(code) ?? code, code })}</option>`)}
            </select>
            ${this.fieldSource("language")}
            <small id="language-help">${messages.t("languageHelp")}</small>
          </label>
          <div class="ui-form-field">
            <label for="formatLocale">${messages.t("region")}</label>
            <input id="formatLocale" class="ui-input" dir="ltr" spellcheck="false" autocapitalize="off" .value=${live(this.draft.formatLocale)}
              placeholder=${messages.t("useDefault")} aria-describedby=${this.helpIds("formatLocale", "region-help region-default")} aria-invalid=${this.validation?.field === "formatLocale" ? "true" : nothing}
              ?disabled=${this.applying || this.locked("formatLocale")} @input=${(event: Event) => { this.edit("formatLocale", event); }}>
            ${this.fieldSource("formatLocale")}
            <small id="region-help">${messages.t("regionHelp")}</small>
            <small id="region-default">${messages.rich(regionDefault.source === "server" ? "gatewayDefault" : "browserDefault", { value: regionDefault.value, isolate: (parts) => html`<bdi dir="ltr">${parts}</bdi>` })}</small>
          </div>
          <label class="ui-form-field" for="timeZone">
            <span>${messages.t("zone")}</span>
            <input id="timeZone" class="ui-input" dir="ltr" spellcheck="false" autocapitalize="off" .value=${live(this.draft.timeZone)}
              placeholder=${messages.t("useDefault")} aria-describedby=${this.helpIds("timeZone", "zone-help zone-default")} aria-invalid=${this.validation?.field === "timeZone" ? "true" : nothing}
              ?disabled=${this.applying || this.locked("timeZone")} @input=${(event: Event) => { this.edit("timeZone", event); }}>
            ${this.fieldSource("timeZone")}
            <small id="zone-help">${messages.t("zoneHelp")}</small>
            <small id="zone-default">${messages.rich(zoneDefault.source === "server" ? "gatewayDefault" : "browserDefault", { value: zoneDefault.value, isolate: (parts) => html`<bdi dir="ltr">${parts}</bdi>` })}</small>
          </label>
          <label class="ui-form-field" for="hourCycle">
            <span>${messages.t("hours")}</span>
            <select id="hourCycle" class="ui-input" aria-describedby=${this.validation?.field === "hourCycle" ? "localization-validation" : nothing} aria-invalid=${this.validation?.field === "hourCycle" ? "true" : nothing} ?disabled=${this.applying || this.locked("hourCycle")} @change=${(event: Event) => { this.edit("hourCycle", event); }}>
              <option value="" ?selected=${selectedClockFormat === ""}>${messages.t(localization.preferenceDefaults.hourCycle === undefined ? "hoursDefault" : "hoursGatewayDefault")}</option>
              ${(["h12", "h23"] as const).map((cycle) => html`<option value=${cycle} ?selected=${cycle === selectedClockFormat}>${messages.t(cycle)}</option>`)}
            </select>
          </label>
          ${this.fieldSource("hourCycle")}
          ${this.validation ? html`<p class="ui-form-error" id="localization-validation" role="alert">${messages.t(this.validation.key)}</p>` : nothing}
          ${this.failure !== undefined ? html`<p class="ui-form-error" role="alert">${messages.t("applyFailure", { diagnostic: this.failure })}</p>` : nothing}
          <div class="ui-settings-summary" aria-label=${messages.t("preview")}>
            <strong>${messages.t("preview")}</strong>
            <span>${messages.t("datePreview", { value: localization.date(this.previewDate, { dateStyle: "medium", timeStyle: "short" }) })}</span>
            <span>${messages.t("numberPreview", { value: localization.number(12345.67) })}</span>
          </div>
          <footer class="ui-settings-actions">
            <button type="submit" class="ui-button ui-button--action ui-button--primary" ?disabled=${this.applying}>${messages.t(this.applying ? "applying" : "apply")}</button>
            <button type="button" class="ui-button ui-button--action" ?disabled=${this.applying}
              @click=${() => { this.save({}); }}>${messages.t("reset")}</button>
          </footer>
          <p role="status">${this.saved ? messages.t("saved") : nothing}</p>
        </form>
      </section>
    `;
  }

  private helpIds(field: Field, help: string): string {
    return this.validation?.field === field ? `${help} localization-validation` : help;
  }

  private edit(field: Field, event: Event): void {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return;
    this.setField(field, event.target.value);
  }

  private setField(field: Field, value: string): void {
    this.draft = { ...this.draft, [field]: value };
    if (this.validation?.field === field) this.validation = undefined;
    this.saved = false;
    this.failure = undefined;
  }

  private async apply(draft: Draft): Promise<void> {
    if (this.applying) return;
    this.validation = validateDraft(draft);
    this.failure = undefined;
    this.saved = false;
    if (this.validation) {
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLElement>(`#${this.validation.field}`)?.focus();
      return;
    }
    const overrides = { ...localization.preferenceOverrides };
    for (const field of ["language", "formatLocale", "timeZone", "hourCycle"] as const) {
      if (this.locked(field) || draft[field] === this.baseline[field] && localization.preferenceOverrides[field] === undefined) continue;
      const value = field === "language" ? availableLanguage(draft.language.trim()) : field === "hourCycle" ? clockFormat(draft) : draft[field].trim();
      Reflect.deleteProperty(overrides, field);
      if (value) Object.assign(overrides, { [field]: value });
    }
    this.save(overrides);
  }

  private save(overrides: Partial<LocalizationPreferences>): void {
    if (this.applying) return;
    this.applying = true;
    this.validation = undefined;
    this.failure = undefined;
    this.saved = false;
    try {
      // The choice commits synchronously. Catalog readiness must not block this form.
      const writable = { ...overrides };
      for (const field of ["language", "formatLocale", "timeZone", "hourCycle"] as const) {
        if (!this.locked(field)) continue;
        Reflect.deleteProperty(writable, field);
        const saved = localization.preferenceOverrides[field];
        if (saved !== undefined) Object.assign(writable, { [field]: saved });
      }
      void localization.setPreferenceOverrides(writable);
      this.baseline = draftFromPreferences(this.displayedPreferences());
      this.draft = { ...this.baseline };
      this.saved = true;
    } catch (cause) {
      this.failure = cause instanceof Error ? cause.message : String(cause);
    } finally { this.applying = false; }
  }

  static override styles = [uiButtonStyles, uiFormStyles, uiSettingsStyles, css`
    :host { display: block; min-width: 0; }
    p { margin: 0; }
    p, small { color: var(--pi-muted); line-height: 1.45; }
    .ui-settings-summary span { overflow-wrap: anywhere; }
    .ui-form-error { color: var(--pi-error); }
  `];
}

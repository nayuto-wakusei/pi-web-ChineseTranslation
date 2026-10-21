import { t } from "../../i18n";
import { stylesheetIntegrationCapability } from "../../plugins/styles";
import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { QualifiedThemeContribution } from "../../plugins/types";
import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from "../../theme";
import { uiButtonStyles } from "../ui/controlStyles";
import { uiFormStyles } from "../ui/formStyles";
import { uiSettingsStyles } from "../ui/settingsStyles";

@customElement("settings-theme-panel")
export class SettingsThemePanel extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) themes: readonly QualifiedThemeContribution[] = [];
  @property({ attribute: false }) preference: ThemePreference = DEFAULT_THEME_PREFERENCE;
  @property({ attribute: false }) defaultPreference: ThemePreference = DEFAULT_THEME_PREFERENCE;
  @property() activeThemeId = "";
  @property({ type: Boolean }) hasLocalOverride = false;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property({ attribute: false }) onUseLocal?: (preference: ThemePreference) => void;
  @property({ attribute: false }) onSetDefault?: (preference: ThemePreference) => void | Promise<void>;
  @property({ attribute: false }) onUseDefault?: () => void;
  @state() private draft: ThemePreference = { ...DEFAULT_THEME_PREFERENCE };

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("preference")) this.draft = { ...this.preference };
  }

  protected override updated(): void {
    // Select values must be applied after their options have been rendered.
    const select = this.renderRoot.querySelector("select");
    if (select !== null) select.value = this.draft.themeId;
  }

  override render(): TemplateResult {
    const selectedAvailable = this.themes.some((theme) => theme.id === this.draft.themeId);
    const busy = this.loading || this.saving;
    return html`
      <section class="theme-card ui-settings-section" aria-labelledby="theme-heading">
        <header class="ui-settings-heading">
          <h3 id="theme-heading">${t("ui.settingsThemePanel.title", "Theme")}</h3>
          <p>${t("ui.settingsThemePanel.scope", "Choose a theme for this browser, or save the gateway default.")}</p>
        </header>
        <div class="current-theme ui-settings-summary" role="status">
          <strong>${this.hasLocalOverride ? t("ui.settingsThemePanel.local", "Using a theme saved in this browser") : t("ui.settingsThemePanel.default", "Using the default theme")}</strong>
          <span>${t("ui.settingsThemePanel.current", "Current: {theme}", { theme: this.themeName(this.activeThemeId || this.preference.themeId) })}</span>
          <span>${t("ui.settingsThemePanel.defaultName", "Default: {theme}", { theme: this.themeName(this.defaultPreference.themeId) })}${this.defaultPreference.auto ? t("ui.settingsThemePanel.systemSuffix", " · Follows system appearance") : ""}</span>
        </div>
        <label class="field ui-form-field">
          <span>${t("ui.settingsThemePanel.title", "Theme")}</span>
          <select class="ui-input" aria-label=${t("ui.settingsThemePanel.title", "Theme")} aria-describedby=${selectedAvailable ? "theme-scope-help" : "theme-unavailable-help theme-scope-help"} ?disabled=${busy} @change=${(event: Event) => {
            if (event.target instanceof HTMLSelectElement) this.draft = { ...this.draft, themeId: event.target.value };
          }}>
            ${!selectedAvailable ? html`<option value=${this.draft.themeId}>${t("ui.settingsThemePanel.unavailable", "{theme} (unavailable)", { theme: this.draft.themeId })}</option>` : null}
            ${this.themes.map((theme) => html`<option value=${theme.id}>${theme.name}</option>`)}
          </select>
        </label>
        ${!selectedAvailable ? html`<p id="theme-unavailable-help" role="status">${t("ui.settingsThemePanel.unavailableHelp", "This theme is unavailable. Choose an available theme, or enable the plugin that provides it.")}</p>` : null}
        <label class="auto-field ui-checkbox-field">
          <input type="checkbox" .checked=${this.draft.auto} ?disabled=${busy} @change=${(event: Event) => {
            if (event.target instanceof HTMLInputElement) this.draft = { ...this.draft, auto: event.target.checked };
          }}>
          <span>${t("ui.settingsThemePanel.auto", "Follow system appearance")} <small>${t("ui.settingsThemePanel.autoHelp", "Switch between light and dark versions when this theme supports both.")}</small></span>
        </label>
        <div class="theme-actions ui-settings-actions">
          <button class="primary ui-button ui-button--action ui-button--primary" ?disabled=${busy || !selectedAvailable} @click=${() => this.onUseLocal?.({ ...this.draft })}>${t("ui.settingsThemePanel.useLocal", "Use in this browser")}</button>
          <button class="ui-button ui-button--action" ?disabled=${busy || !selectedAvailable} @click=${() => { void this.onSetDefault?.({ ...this.draft }); }}>${t("ui.settingsThemePanel.setDefault", "Set gateway default")}</button>
          <button class="ui-button ui-button--action" ?disabled=${busy || !this.hasLocalOverride} @click=${() => this.onUseDefault?.()}>${t("ui.settingsThemePanel.useDefault", "Use the default")}</button>
        </div>
        <p class="hint" id="theme-scope-help">${t("ui.settingsThemePanel.scopeHelp", "Setting a default leaves saved browser choices unchanged. Use the default to remove this browser's override.")}</p>
      </section>
    `;
  }

  private themeName(id: string): string {
    return this.themes.find((theme) => theme.id === id)?.name ?? t("ui.settingsThemePanel.unavailable", "{theme} (unavailable)", { theme: id });
  }

  static override styles = [uiButtonStyles, uiFormStyles, uiSettingsStyles, css`
    :host { display: block; }
    p { margin: 0; }
    p, small { color: var(--pi-muted); line-height: 1.45; }
    .current-theme span { color: var(--pi-text-secondary); font-size: 12px; overflow-wrap: anywhere; }
    .auto-field span { display: grid; gap: 3px; }
    .hint { font-size: 12px; }
  `];
}

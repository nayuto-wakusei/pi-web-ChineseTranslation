import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { LocalizationController, localization } from "../../localization/browser";
import { DEFAULT_FILE_ICON_THEME_ID, NO_FILE_ICONS } from "../../fileIconPreferences";
import type { QualifiedFileIconThemeContribution } from "../../plugins/types";
import { stylesheetIntegrationCapability } from "../../plugins/styles";
import { uiButtonStyles } from "../ui/controlStyles";
import { uiFormStyles } from "../ui/formStyles";
import { uiSettingsStyles } from "../ui/settingsStyles";
import source from "./settingsFileIconTheme.messages";

const messages = localization.registerMessages("core.settingsFileIconTheme", source);

@customElement("settings-file-icon-theme-panel")
export class SettingsFileIconThemePanel extends LitElement {
  constructor() {
    super();
    new LocalizationController(this);
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) themes: readonly QualifiedFileIconThemeContribution[] = [];
  @property({ attribute: false }) preference: string | undefined;
  @property({ attribute: false }) onSelect?: (id: string) => void;
  @property({ attribute: false }) onReset?: () => void;

  protected override updated(): void {
    const select = this.renderRoot.querySelector("select");
    if (select !== null) select.value = this.preference ?? DEFAULT_FILE_ICON_THEME_ID;
  }

  override render(): TemplateResult {
    const selected = this.preference ?? DEFAULT_FILE_ICON_THEME_ID;
    const available = selected === NO_FILE_ICONS || this.themes.some(({ id }) => id === selected);
    return html`
      <section class="ui-settings-section" aria-labelledby="file-icons-heading">
        <header class="ui-settings-heading">
          <h3 id="file-icons-heading">${messages.t("heading")}</h3>
          <p id="file-icons-scope">${messages.t("scope")}</p>
        </header>
        <label class="ui-form-field">
          <span>${messages.t("heading")}</span>
          <select class="ui-select" aria-describedby=${available ? "file-icons-scope" : "file-icons-scope file-icons-unavailable"} @change=${(event: Event) => {
            if (event.target instanceof HTMLSelectElement) this.onSelect?.(event.target.value);
          }}>
            ${!available ? html`<option value=${selected}>${messages.t("unavailable", { id: selected })}</option>` : null}
            <option value=${NO_FILE_ICONS}>${messages.t("none")}</option>
            ${this.themes.map((theme) => html`<option value=${theme.id}>${theme.name}</option>`)}
          </select>
        </label>
        ${!available ? html`<p id="file-icons-unavailable" role="status">${messages.t("unavailableHelp")}</p>` : null}
        <div class="ui-settings-actions">
          <button class="ui-button ui-button--action" ?disabled=${this.preference === undefined} @click=${() => this.onReset?.()}>${messages.t("reset")}</button>
        </div>
      </section>
    `;
  }

  static override styles = [uiButtonStyles, uiFormStyles, uiSettingsStyles, css`
    :host { display: block; }
    p { margin: 0; color: var(--pi-muted); line-height: 1.45; }
  `];
}

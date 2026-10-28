import { LocalizationController, localization } from "../../localization/browser";
import source from "./settingsPackages.messages";
import { uiSettingsStyles } from "../ui/settingsStyles";
import { uiFormStyles } from "../ui/formStyles";
import { uiButtonStyles } from "../ui/controlStyles";
import { stylesheetIntegrationCapability } from "../../plugins/styles";
import { t } from "../../i18n.js";
import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PiPackageInfo, PiPackageInstallableSuggestion, PiPackageScope, PiPackagesResponse } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { isPiPackageManagementUnsupported, type PiPackageManagementSupport, canUpdatePiPackage, canUpdateAllPiPackages, isPiPackageOperationPending, normalizePiPackageSource, piPackageSourceValidationMessage, piPackageTargetContext, type PiPackageOperationState, type PiPackageTargetContext } from "./piPackageSettings";

export const packagesMessages = localization.registerMessages("core.settingsPackages", source);
const strong = (chunks: readonly unknown[]) => html`<strong>${chunks}</strong>`;
const code = (chunks: readonly unknown[]) => html`<code dir="ltr">${chunks}</code>`;

// Reserved bundled package IDs supply presentation identity, never English text.
function suggestionPresentation(suggestion: PiPackageInstallableSuggestion): { label: string; description: string } {
  switch (suggestion.id) {
    case "@jmfederico/pi-relay": return { label: packagesMessages.t("relayName"), description: packagesMessages.t("relayDescription") };
    case "@jmfederico/pi-web-workflows": return { label: packagesMessages.t("workflowsName"), description: packagesMessages.t("workflowsDescription") };
    default: return suggestion;
  }
}

@customElement("settings-packages-panel")
export class SettingsPackagesPanel extends LitElement {
  constructor() {
    super();
    new LocalizationController(this);
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) packagesResponse: PiPackagesResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ attribute: false }) operation: PiPackageOperationState | undefined;
  @property({ attribute: false }) targetMachine: PiPackageTargetContext | undefined;
  @property({ attribute: false }) managementSupport: PiPackageManagementSupport | undefined;
  @property() error = "";
  @property() operationMessage = "";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onInstallPackage?: (source: string) => void | Promise<void>;
  @property({ attribute: false }) onRemovePackage?: (source: string, scope: PiPackageScope) => void | Promise<void>;
  @property({ attribute: false }) onUpdatePackage?: (source?: string) => void | Promise<void>;
  @state() private installSource = "";
  @state() private validationFailed = false;

  override render(): TemplateResult {
    const packages = this.packagesResponse?.packages ?? [];
    const target = this.packageTarget;
    const targetLabel = packagesMessages.t("target", { name: target.name, kind: target.kind });
    const packageManagementUnavailable = this.packageManagementUnavailable;
    const showPackageControls = this.packagesResponse !== undefined && !packageManagementUnavailable;
    return html`
      <settings-panel-frame
        heading=${packagesMessages.t("heading")}
        .description=${html`${packagesMessages.rich("description", { target: targetLabel, strong })}`}
        actionLabel=${packagesMessages.t("refresh")}
        actionTitle=${packageManagementUnavailable ? this.packageManagementUnavailableMessage(targetLabel) : packagesMessages.t("refreshTitle", { target: targetLabel })}
        .actionDisabled=${this.loading || this.isOperating || packageManagementUnavailable}
        .notices=${this.panelNotices(targetLabel, showPackageControls)}
        .onAction=${this.onReload}
      >
        <p><a href="https://pi-web.dev/community-plugins" target="_blank" rel="noopener noreferrer">${packagesMessages.t("community")}</a></p>
        ${this.renderPanelContent(packages, target, targetLabel)}
      </settings-panel-frame>
    `;
  }

  private panelNotices(targetLabel: string, showTrustedCodeWarning: boolean): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    if (this.packageManagementUnavailable) {
      notices.push({ type: "availability", content: this.packageManagementUnavailableMessage(targetLabel) });
    } else if (this.error !== "") {
      notices.push({ type: "error", content: this.error });
    }
    if (this.operationMessage !== "") notices.push({ type: "success", content: this.operationMessage });
    if (showTrustedCodeWarning) {
      notices.push({
        type: "security",
        content: html`${packagesMessages.rich("trusted", { strong })}`,
      });
    }
    return notices;
  }

  private renderPanelContent(packages: PiPackageInfo[], target: PiPackageTargetContext, targetLabel: string): TemplateResult | null {
    if (this.packageManagementUnavailable) return null;
    if (this.packagesResponse === undefined) {
      return html`<div class="loading-card ui-settings-summary">${packagesMessages.t(this.loading ? "loading" : "unavailable", { target: targetLabel })}</div>`;
    }
    return html`
      ${this.renderInstallableKnownPackages(targetLabel)}
      ${this.renderInstallForm(targetLabel)}
      ${this.renderPackageList(packages, target)}
    `;
  }

  private renderInstallableKnownPackages(targetLabel: string): TemplateResult | null {
    const suggestions = this.packagesResponse?.installableKnownPackages ?? [];
    if (suggestions.length === 0) return null;
    return html`
      <section class="known-package-section ui-settings-section" aria-label=${packagesMessages.t("availableAria")}>
        <div class="ui-settings-heading">
          <h3>${packagesMessages.t("available")}</h3>
          <p>${packagesMessages.t("availableHelp", { target: targetLabel })}</p>
        </div>
        <div class="known-package-list ui-settings-list">
          ${suggestions.map((suggestion) => this.renderInstallableKnownPackage(suggestion))}
        </div>
      </section>
    `;
  }

  private renderInstallableKnownPackage(suggestion: PiPackageInstallableSuggestion): TemplateResult {
    const installing = isPiPackageOperationPending(this.operation, "install", suggestion.source);
    const presentation = suggestionPresentation(suggestion);
    return html`
      <article class="known-package-card ui-settings-row">
        <div class="package-main">
          <strong dir="auto">${presentation.label}</strong>
          <small dir="auto">${presentation.description}</small>
        </div>
        <button class="ui-button ui-button--action ui-button--primary" title=${packagesMessages.t("installAria", { name: presentation.label })} aria-label=${packagesMessages.t("installAria", { name: presentation.label })} ?disabled=${this.isOperating} @click=${() => { void this.installKnownPackage(suggestion.source); }}>${packagesMessages.t(installing ? "installing" : "install")}</button>
      </article>
    `;
  }

  private renderInstallForm(targetLabel: string): TemplateResult {
    return html`
      <form class="install-card ui-settings-section" @submit=${(event: Event) => { void this.installPackage(event); }}>
        <label class="ui-form-field" for="package-source">${packagesMessages.t("source")}</label>
        <div class="install-row">
          <input class="ui-input" id="package-source" dir="ltr" aria-describedby="package-source-help package-source-error" aria-invalid=${this.validationFailed ? "true" : "false"} .value=${this.installSource} ?disabled=${this.isOperating} placeholder=${packagesMessages.t("placeholder")} @input=${(event: Event) => { this.updateInstallSource(event); }}>
          <button class="ui-button ui-button--action ui-button--primary" type="submit" title=${packagesMessages.t("installTitle")} ?disabled=${this.isOperating}>${packagesMessages.t(isPiPackageOperationPending(this.operation, "install") ? "installing" : "install")}</button>
        </div>
        <div id="package-source-error" class="field-error" role="alert">${this.validationFailed ? packagesMessages.t("validation") : ""}</div>
        <small id="package-source-help">${packagesMessages.rich("sourceHelp", { target: targetLabel, command: "pi install <source>", code })}</small>
      </form>
    `;
  }

  private renderPackageList(packages: PiPackageInfo[], target: PiPackageTargetContext): TemplateResult {
    const targetLabel = packagesMessages.t("target", { name: target.name, kind: target.kind });
    const updateAllReason = canUpdateAllPiPackages(packages) ? undefined : packagesMessages.t(packages.length === 0 ? "noUpdates" : "mixedUpdates");
    const showUpdateAllReason = updateAllReason !== undefined && packages.length > 0;
    const updateAllTitle = updateAllReason ?? packagesMessages.t("updateAllTitle");
    return html`
      <section class="package-section ui-settings-section" aria-label=${packagesMessages.t("configured")}>
        <div class="package-toolbar">
          <div class="ui-settings-heading">
            <h3>${packagesMessages.t("configured")}</h3>
            <p>${packagesMessages.t("configuredHelp", { target: targetLabel })}</p>
          </div>
          <button class="secondary ui-button ui-button--action" title=${updateAllTitle} ?disabled=${this.isOperating || updateAllReason !== undefined} @click=${() => { void this.updatePackage(); }}>
            ${packagesMessages.t(isPiPackageOperationPending(this.operation, "update-all") ? "updating" : "updateAll")}
          </button>
        </div>
        ${showUpdateAllReason ? html`<div class="action-note">${updateAllReason}</div>` : null}
        ${this.loading && packages.length > 0 ? html`<div class="action-note">${packagesMessages.t("refreshing", { target: targetLabel })}</div>` : null}
        ${this.renderPackageListContent(packages, targetLabel)}
      </section>
    `;
  }

  private renderPackageListContent(packages: PiPackageInfo[], targetLabel: string): TemplateResult {
    if (this.loading && packages.length === 0) return html`<div class="loading-card ui-settings-summary">${packagesMessages.t("loading", { target: targetLabel })}</div>`;
    if (packages.length === 0) return html`<div class="loading-card ui-settings-summary">${packagesMessages.t("empty", { target: targetLabel })}</div>`;
    return html`
      <div class="package-list ui-settings-list">
        ${packages.map((packageInfo) => this.renderPackage(packageInfo))}
      </div>
    `;
  }

  private renderPackage(packageInfo: PiPackageInfo): TemplateResult {
    const targetLabel = packagesMessages.t("target", { name: this.packageTarget.name, kind: this.packageTarget.kind });
    const packageManagementUnavailable = this.packageManagementUnavailable;
    const updateReason = packageManagementUnavailable ? this.packageManagementUnavailableMessage(targetLabel) : canUpdatePiPackage(packageInfo) ? undefined : packagesMessages.t("projectUpdate");
    const removeReason = packageManagementUnavailable ? this.packageManagementUnavailableMessage(targetLabel) : packagesMessages.t("removeTitle");
    const updating = isPiPackageOperationPending(this.operation, "update", packageInfo.source);
    const removing = isPiPackageOperationPending(this.operation, "remove", packageInfo.source);
    return html`
      <article class=${`package-card ui-settings-row${packageInfo.filtered ? " filtered" : ""}`}>
        <div class="package-main">
          <strong dir="auto">${packageInfo.source}</strong>
          <small>${packagesMessages.t("metadata", { scope: packageInfo.scope, filtered: packageInfo.filtered ? "yes" : "no" })}</small>
          <small>${packagesMessages.rich("installedPath", { path: packageInfo.installedPath ?? packagesMessages.t("pathUnknown"), code })}</small>
          ${updateReason === undefined ? null : html`<small class="action-note">${updateReason}</small>`}
        </div>
        <div class="package-actions ui-settings-actions">
          <button class="secondary ui-button ui-button--action" aria-label=${packagesMessages.t("updateAria", { name: packageInfo.source })} title=${updateReason ?? packagesMessages.t("updateTitle")} ?disabled=${this.isOperating || updateReason !== undefined} @click=${() => { void this.updatePackage(packageInfo.source); }}>${packagesMessages.t(updating ? "updating" : "update")}</button>
          <button class="danger ui-button ui-button--action" aria-label=${packagesMessages.t("removeAria", { name: packageInfo.source })} title=${removeReason} ?disabled=${this.isOperating || packageManagementUnavailable} @click=${() => { void this.removePackage(packageInfo); }}>${packagesMessages.t(removing ? "removing" : "remove")}</button>
        </div>
      </article>
    `;
  }

  private updateInstallSource(event: Event): void {
    this.installSource = event.target instanceof HTMLInputElement ? event.target.value : "";
    this.validationFailed = false;
  }

  private async installPackage(event: Event): Promise<void> {
    event.preventDefault();
    const validationMessage = piPackageSourceValidationMessage(this.installSource);
    if (validationMessage !== undefined) {
      this.validationFailed = true;
      return;
    }

    const source = normalizePiPackageSource(this.installSource);
    try {
      await this.onInstallPackage?.(source);
      this.installSource = "";
      this.validationFailed = false;
    } catch {
      // The parent owns network error presentation so package errors are consistent across Settings.
    }
  }

  private async removePackage(packageInfo: PiPackageInfo): Promise<void> {
    try {
      await this.onRemovePackage?.(packageInfo.source, packageInfo.scope);
    } catch {
      // The parent owns network error presentation so package errors are consistent across Settings.
    }
  }

  private async installKnownPackage(source: string): Promise<void> {
    try {
      await this.onInstallPackage?.(source);
    } catch {
      // The parent owns network error presentation so package errors are consistent across Settings.
    }
  }

  private async updatePackage(source?: string): Promise<void> {
    try {
      await this.onUpdatePackage?.(source);
    } catch {
      // The parent owns network error presentation so package errors are consistent across Settings.
    }
  }

  private get packageTarget(): PiPackageTargetContext {
    return this.targetMachine ?? piPackageTargetContext(undefined);
  }

  private get packageManagementUnavailable(): boolean {
    return isPiPackageManagementUnsupported(this.managementSupport);
  }

  private packageManagementUnavailableMessage(targetLabel: string): string {
    return this.managementSupport?.message ?? t("ui.settingsPackagesPanel.doesNotSupportPiPackageManagement", "{targetLabel} does not support Pi package management.", { targetLabel: targetLabel });
  }

  private get isOperating(): boolean {
    return this.operation !== undefined;
  }

  static override styles = [uiButtonStyles, uiFormStyles, uiSettingsStyles, css`
    @layer pi-web-base {
    :host { display: block; }
    .package-toolbar { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 14px; }
    .package-toolbar > div { flex: 1 1 240px; min-width: 0; }
    .package-main { flex: 1 1 240px; display: grid; gap: 6px; min-width: 0; }
    small { color: var(--pi-muted); line-height: 1.45; }
    .secondary { flex: 0 0 auto; }
    .field-error { color: var(--pi-danger); font-size: 12px; }
    .field-error:empty { display: none; }
    .install-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
    .known-package-section, .package-section { padding: 0; gap: 0; }
    .known-package-section > .ui-settings-heading, .package-toolbar { padding: 16px; }
    .loading-card, .action-note { color: var(--pi-muted); }
    .action-note { font-size: 12px; }
    .package-section > .action-note { padding: 0 16px 12px; }
    .package-card, .known-package-card { align-items: center; }
    .package-card.filtered { opacity: .82; }
    .package-main strong, .package-main small { overflow-wrap: anywhere; }
    code { color: var(--pi-text); font: 12px var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); overflow-wrap: anywhere; }

    @media (max-width: 760px) {
      .install-row { grid-template-columns: minmax(0, 1fr); }
      .install-row > .ui-button { justify-self: start; }
      .package-main { flex-basis: 100%; }
    }

    }
  `];
}

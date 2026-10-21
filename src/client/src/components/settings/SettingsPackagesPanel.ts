import { t } from "../../i18n.js";
import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PiPackageInfo, PiPackageScope, PiPackagesResponse } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { isPiPackageManagementUnsupported, isPiPackageOperationPending, normalizePiPackageSource, piPackageFilteredLabel, piPackageInstalledPathLabel, piPackageScopeLabel, piPackageSourceValidationMessage, piPackageTargetContext, piPackageTargetLabel, piPackageUpdateDisabledReason, updateAllPiPackagesDisabledReason, type PiPackageManagementSupport, type PiPackageOperationState, type PiPackageTargetContext } from "./piPackageSettings";

@customElement("settings-packages-panel")
export class SettingsPackagesPanel extends LitElement {
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
  @state() private validationMessage = "";

  override render(): TemplateResult {
    const packages = this.packagesResponse?.packages ?? [];
    const target = this.packageTarget;
    const targetLabel = piPackageTargetLabel(target);
    const packageManagementUnavailable = this.packageManagementUnavailable;
    const showPackageControls = this.packagesResponse !== undefined && !packageManagementUnavailable;
    return html`
      <settings-panel-frame
        heading=${t("ui.settingsPackagesPanel.piPackages", "Pi packages")}
        .description=${packagesDescription(targetLabel)}
        actionLabel=${t("ui.settingsPackagesPanel.reload", "Reload")}
        actionTitle=${packageManagementUnavailable ? this.packageManagementUnavailableMessage(targetLabel) : t("ui.settingsPackagesPanel.reloadPiPackagesFrom", "Reload Pi packages from {targetLabel}", { targetLabel: targetLabel })}
        .actionDisabled=${this.loading || this.isOperating || packageManagementUnavailable}
        .notices=${this.panelNotices(targetLabel, showPackageControls)}
        .onAction=${this.onReload}
      >
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
        content: html`<strong>${t("ui.settingsPackagesPanel.trustedCodeWarning", "Trusted code warning:")}</strong>${t("ui.settingsPackagesPanel.piPackagesAndPiWebPluginsCanRun", "Pi packages and PI WEB plugins can run with your user permissions. Only install or enable trusted sources.")}`,
      });
    }
    return notices;
  }

  private renderPanelContent(packages: PiPackageInfo[], target: PiPackageTargetContext, targetLabel: string): TemplateResult | null {
    if (this.packageManagementUnavailable) return null;
    if (this.packagesResponse === undefined) {
      return html`<div class="loading-card">${this.loading ? t("ui.settingsPackagesPanel.loadingPiPackagesFrom", "Loading Pi packages from {targetLabel}…", { targetLabel: targetLabel }) : t("ui.settingsPackagesPanel.piPackageListForIsUnavailableReload", "Pi package list for {targetLabel} is unavailable. Reload.", { targetLabel: targetLabel })}</div>`;
    }
    return html`
      ${this.renderInstallForm(targetLabel)}
      ${this.renderPackageList(packages, target)}
    `;
  }

  private renderInstallForm(targetLabel: string): TemplateResult {
    return html`
      <form class="install-card" @submit=${(event: Event) => { void this.installPackage(event); }}>
        <label for="package-source">${t("ui.settingsPackagesPanel.piPackageSource", "Pi package source")}</label>
        <div class="install-row">
          <input id="package-source" .value=${this.installSource} ?disabled=${this.isOperating} placeholder=${t("ui.settingsPackagesPanel.npmScopePackageGitUrlOrLocalPath", "npm:@scope/package, Git URL, or local path")} @input=${(event: Event) => { this.updateInstallSource(event); }}>
          <button type="submit" title=${t("ui.settingsPackagesPanel.installThisPiPackage", "Install this Pi package")} ?disabled=${this.isOperating}>${isPiPackageOperationPending(this.operation, "install") ? t("ui.settingsPackagesPanel.installing", "Installing…") : t("ui.settingsPackagesPanel.install", "Install")}</button>
        </div>
        ${this.validationMessage === "" ? null : html`<div class="field-error">${this.validationMessage}</div>`}
        <small>${t("ui.settingsPackagesPanel.installationScope", "Installation runs on {machine} using Pi's default package location, equivalent to pi install <source>. PI WEB does not ask you to choose an installation location.", { machine: targetLabel })}</small>
      </form>
    `;
  }

  private renderPackageList(packages: PiPackageInfo[], target: PiPackageTargetContext): TemplateResult {
    const targetLabel = piPackageTargetLabel(target);
    const packageManagementUnavailable = this.packageManagementUnavailable;
    const updateAllReason = packageManagementUnavailable ? this.packageManagementUnavailableMessage(targetLabel) : updateAllPiPackagesDisabledReason(packages);
    const showUpdateAllReason = updateAllReason !== undefined && packages.length > 0;
    const updateAllTitle = updateAllReason ?? t("ui.settingsPackagesPanel.updateAllUserScopedPiPackages", "Update all user-scoped Pi packages");
    return html`
      <section class="package-section" aria-label=${t("ui.settingsPackagesPanel.configuredPiPackages", "Configured Pi packages")}>
        <div class="package-toolbar">
          <div>
            <h3>${t("ui.settingsPackagesPanel.configuredPiPackages", "Configured Pi packages")}</h3>
            <p>${t("ui.settingsPackagesPanel.listScope", "This list comes from Pi package manager settings on {machine}.", { machine: targetLabel })}</p>
          </div>
          <button class="secondary" title=${updateAllTitle} ?disabled=${this.isOperating || updateAllReason !== undefined} @click=${() => { void this.updatePackage(); }}>
            ${isPiPackageOperationPending(this.operation, "update-all") ? t("ui.settingsPackagesPanel.updating", "Updating…") : t("ui.settingsPackagesPanel.updateAll", "Update all")}
          </button>
        </div>
        ${showUpdateAllReason ? html`<div class="action-note">${updateAllReason}</div>` : null}
        ${this.loading && packages.length > 0 ? html`<div class="action-note">${t("ui.settingsPackagesPanel.refreshingPackages", "Refreshing Pi packages from {machine}…", { machine: targetLabel })}</div>` : null}
        ${this.renderPackageListContent(packages, targetLabel)}
      </section>
    `;
  }

  private renderPackageListContent(packages: PiPackageInfo[], targetLabel: string): TemplateResult {
    if (this.loading && packages.length === 0) return html`<div class="loading-card">${t("ui.settingsPackagesPanel.loadingPackages", "Loading Pi packages from {machine}…", { machine: targetLabel })}</div>`;
    if (packages.length === 0) return html`<div class="loading-card">${t("ui.settingsPackagesPanel.noPackages", "No Pi packages are configured in Pi settings on {machine}.", { machine: targetLabel })}</div>`;
    return html`
      <div class="package-list">
        ${packages.map((packageInfo) => this.renderPackage(packageInfo))}
      </div>
    `;
  }

  private renderPackage(packageInfo: PiPackageInfo): TemplateResult {
    const targetLabel = piPackageTargetLabel(this.packageTarget);
    const packageManagementUnavailable = this.packageManagementUnavailable;
    const updateReason = packageManagementUnavailable ? this.packageManagementUnavailableMessage(targetLabel) : piPackageUpdateDisabledReason(packageInfo);
    const removeReason = packageManagementUnavailable ? this.packageManagementUnavailableMessage(targetLabel) : t("ui.settingsPackagesPanel.removeThisPiPackage", "Remove this Pi package");
    const updating = isPiPackageOperationPending(this.operation, "update", packageInfo.source);
    const removing = isPiPackageOperationPending(this.operation, "remove", packageInfo.source);
    return html`
      <article class=${`package-card${packageInfo.filtered ? " filtered" : ""}`}>
        <div class="package-main">
          <strong>${packageInfo.source}</strong>
          <small>${piPackageScopeLabel(packageInfo)} · ${piPackageFilteredLabel(packageInfo)}</small>
          <small>${t("ui.settingsPackagesPanel.installationPath", "Installation path: ")}<code>${piPackageInstalledPathLabel(packageInfo)}</code></small>
          ${updateReason === undefined ? null : html`<small class="action-note">${updateReason}</small>`}
        </div>
        <div class="package-actions">
          <button class="secondary" title=${updateReason ?? t("ui.settingsPackagesPanel.updateThisPiPackage", "Update this Pi package")} ?disabled=${this.isOperating || updateReason !== undefined} @click=${() => { void this.updatePackage(packageInfo.source); }}>${updating ? t("ui.settingsPackagesPanel.updating", "Updating…") : t("ui.settingsPackagesPanel.update", "Update")}</button>
          <button class="danger" title=${removeReason} ?disabled=${this.isOperating || packageManagementUnavailable} @click=${() => { void this.removePackage(packageInfo); }}>${removing ? t("ui.settingsPackagesPanel.removing", "Removing…") : t("ui.settingsPackagesPanel.remove", "Remove")}</button>
        </div>
      </article>
    `;
  }

  private updateInstallSource(event: Event): void {
    this.installSource = event.target instanceof HTMLInputElement ? event.target.value : "";
    this.validationMessage = "";
  }

  private async installPackage(event: Event): Promise<void> {
    event.preventDefault();
    const validationMessage = piPackageSourceValidationMessage(this.installSource);
    if (validationMessage !== undefined) {
      this.validationMessage = validationMessage;
      return;
    }

    const source = normalizePiPackageSource(this.installSource);
    try {
      await this.onInstallPackage?.(source);
      this.installSource = "";
      this.validationMessage = "";
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

  static override styles = css`
    :host { display: block; }
    .package-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
    .package-toolbar > div, .package-main { display: grid; gap: 6px; min-width: 0; }
    h3, p { margin: 0; }
    h3 { font-size: 15px; line-height: 1.25; }
    p, small { color: var(--pi-muted); line-height: 1.45; }
    button, input { font: inherit; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
    button:disabled, input:disabled { opacity: .55; cursor: not-allowed; }
    input { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); padding: 8px 9px; }
    label { font-weight: 700; }
    .secondary { flex: 0 0 auto; }
    .danger { border-color: color-mix(in srgb, var(--pi-danger) 55%, var(--pi-border)); color: var(--pi-danger); }
    .loading-card, .install-card, .package-card { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .field-error { color: var(--pi-danger); font-size: 12px; }
    .install-card { display: grid; gap: 8px; }
    .install-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
    .package-section { display: block; }
    .loading-card, .action-note { color: var(--pi-muted); }
    .action-note { margin-bottom: 10px; font-size: 12px; }
    .package-list { display: grid; gap: 10px; }
    .package-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
    .package-card.filtered { opacity: .82; }
    .package-main strong, .package-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .package-actions { display: flex; align-items: center; gap: 8px; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }

    @media (max-width: 760px) {
      .package-toolbar { display: grid; gap: 12px; }
      .package-toolbar .secondary { justify-self: start; }
      .install-row, .package-card { grid-template-columns: minmax(0, 1fr); align-items: start; }
      .package-actions { justify-self: start; flex-wrap: wrap; }
      .package-main strong, .package-main small { white-space: normal; }
    }
  `;
}

function packagesDescription(targetLabel: string): TemplateResult {
  return html`${t("ui.settingsPackagesPanel.manage", "Manage ")} <strong>${targetLabel}</strong> ${t("ui.settingsPackagesPanel.piPackagesInstallRemoveAndUpdatePiManaged", " Pi packages. Install, remove, and update Pi-managed packages on the selected machine. Pi packages can provide extensions, skills, prompt templates, themes, context/system prompt files, and PI WEB browser plugins.")}`;
}

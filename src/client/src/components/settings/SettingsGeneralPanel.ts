import { t } from "../../i18n.js";
import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { DEFAULT_WORKSPACE_ATTACHMENTS_FOLDER, DEFAULT_WORKSPACE_UPLOADS_FOLDER, type PiWebConfigEnvOverrides, type PiWebConfigResponse, type PiWebConfigValues } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import {
  emptyGatewayServerConfigDraft,
  emptyMachineAccessConfigDraft,
  gatewayServerConfigFromDraft,
  gatewayServerDraftFromConfig,
  machineAccessConfigPatchFromDraft,
  machineAccessDraftFromConfig,
  type GatewayServerConfigDraft,
  type MachineAccessConfigDraft,
} from "./settingsConfigDraft";

function generalDescription(targetLabel: string): TemplateResult {
  return html`${t("ui.settingsGeneralPanel.settingsScope", "Gateway server fields edit the current local gateway; file access and upload defaults edit {machine}.", { machine: targetLabel })}`;
}

@customElement("settings-general-panel")
export class SettingsGeneralPanel extends LitElement {
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ attribute: false }) machineConfigResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) machineLoading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() machineError = "";
  @property() savedMessage = "";
  @property() targetLabel = "selected machine";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onReloadMachine?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues) => void | Promise<void>;
  @property({ attribute: false }) onSaveMachineConfig?: (config: PiWebConfigValues) => void | Promise<void>;
  @state() private gatewayDraft: GatewayServerConfigDraft = emptyGatewayServerConfigDraft();
  @state() private machineDraft: MachineAccessConfigDraft = emptyMachineAccessConfigDraft();
  @state() private gatewayLocalError = "";
  @state() private machineLocalError = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("configResponse") && this.configResponse !== undefined) {
      this.gatewayDraft = gatewayServerDraftFromConfig(this.configResponse.config);
      this.gatewayLocalError = "";
    }
    if (changed.has("machineConfigResponse") && this.machineConfigResponse !== undefined) {
      this.machineDraft = machineAccessDraftFromConfig(this.machineConfigResponse.config);
      this.machineLocalError = "";
    }
  }

  override render(): TemplateResult {
    return html`
      <settings-panel-frame
        heading=${t("ui.settingsGeneralPanel.generalConfiguration", "General configuration")}
        .description=${generalDescription(this.targetLabel)}
        actionLabel=${t("ui.settingsGeneralPanel.reload", "Reload")}
        .actionDisabled=${this.loading || this.machineLoading}
        .notices=${this.panelNotices()}
        .onAction=${() => { this.reloadAll(); }}
      >
        <div class="settings-sections">
          ${this.renderGatewayServerSettings()}
          ${this.renderSelectedMachineAccessSettings()}
        </div>
      </settings-panel-frame>
    `;
  }

  private renderGatewayServerSettings(): TemplateResult {
    const config = this.configResponse;
    return html`
      <section class="settings-card" aria-label=${t("ui.settingsGeneralPanel.gatewayServerSettings", "Gateway server settings")}>
        <div class="card-heading">
          <h3>${t("ui.settingsGeneralPanel.gatewayServer", "Gateway server")}</h3>
          <p>${t("ui.settingsGeneralPanel.hostPortAndAllowedHostsAreSavedTo", "Host, port, and allowed hosts are saved to gateway configuration. Restart the web service after address changes for the running server to bind to the new address.")}</p>
        </div>
        ${config === undefined && this.loading ? html`<div class="loading-card">${t("ui.settingsGeneralPanel.loadingGatewayConfiguration", "Loading gateway configuration…")}</div>` : html`
          <div class="config-path-card">
            <span>${t("ui.settingsGeneralPanel.gatewayConfigurationFile", "Gateway configuration file")}</span>
            <code>${config?.path ?? t("ui.settingsGeneralPanel.unknown", "Unknown")}</code>
            <small>${config?.exists === true ? t("ui.settingsGeneralPanel.existingFile", "Existing file") : t("ui.settingsGeneralPanel.fileWillBeCreatedOnSave", "File will be created on save")}</small>
          </div>
          <form class="config-form" @submit=${(event: Event) => { void this.saveGatewayConfig(event); }}>
            <label class="field">
              <span class="field-heading">
                <span>${t("ui.settingsGeneralPanel.hostAddress", "Host address")}</span>
                ${this.renderOverrideBadge("host")}
              </span>
              <input .value=${this.gatewayDraft.host} placeholder="127.0.0.1" autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateGatewayDraft({ host: inputValue(event) }); }}>
              <small>${t("ui.settingsGeneralPanel.addressTheWebServerBindsToLeaveBlank", "Address the web server binds to. Leave blank for the PI WEB default.")}</small>
            </label>

            <label class="field">
              <span class="field-heading">
                <span>${t("ui.settingsGeneralPanel.port", "Port")}</span>
                ${this.renderOverrideBadge("port")}
              </span>
              <input .value=${this.gatewayDraft.port} inputmode="numeric" pattern="[0-9]*" placeholder="8504" autocomplete="off" @input=${(event: Event) => { this.updateGatewayDraft({ port: inputValue(event) }); }}>
              <small>${t("ui.settingsGeneralPanel.tcpPortFrom1To65535LeaveBlank", "TCP port from 1 to 65535. Leave blank for the PI WEB default.")}</small>
            </label>

            <div class="field">
              <span class="field-heading">
                <span>${t("ui.settingsGeneralPanel.allowedHosts", "Allowed hosts")}</span>
                ${this.renderOverrideBadge("allowedHosts")}
              </span>
              <select .value=${this.gatewayDraft.allowedHostsMode} @change=${(event: Event) => { this.updateGatewayDraft({ allowedHostsMode: selectValue(event) === "all" ? "all" : "list" }); }}>
                <option value="list">${t("ui.settingsGeneralPanel.allowListedHostsOnly", "Allow listed hosts only")}</option>
                <option value="all">${t("ui.settingsGeneralPanel.allowAllHosts", "Allow all hosts")}</option>
              </select>
              <textarea .value=${this.gatewayDraft.allowedHostsText} ?disabled=${this.gatewayDraft.allowedHostsMode === "all"} rows="4" placeholder="example.local&#10;192.168.1.20" spellcheck="false" @input=${(event: Event) => { this.updateGatewayDraft({ allowedHostsText: textAreaValue(event) }); }}></textarea>
              <small>${t("ui.settingsGeneralPanel.allowedHostsHint", "Enter one host per line, or select \"Allow all hosts\" to write true.")}</small>
            </div>

            ${this.renderGatewayEffectiveConfig()}

            <footer class="form-actions">
              <button class="primary" ?disabled=${this.loading || this.saving}>${this.saving ? t("ui.settingsGeneralPanel.saving", "Saving…") : t("ui.settingsGeneralPanel.saveGatewayServerConfiguration", "Save gateway server configuration")}</button>
            </footer>
          </form>
        `}
      </section>
    `;
  }

  private renderSelectedMachineAccessSettings(): TemplateResult {
    const config = this.machineConfigResponse;
    return html`
      <section class="settings-card" aria-label=${t("ui.settingsGeneralPanel.selectedMachineFileAccessAndUploadSettings", "Selected machine file access and upload settings")}>
        <div class="card-heading">
          <h3>${t("ui.settingsGeneralPanel.selectedMachineFileAccessAndUploads", "Selected machine file access and uploads")}</h3>
          <p>${t("ui.settingsGeneralPanel.fileSettingsScope", "External filesystem roots and upload defaults are saved to {machine}.", { machine: this.targetLabel })}</p>
        </div>
        ${this.renderMachineMessages()}
        ${config === undefined ? html`<div class="loading-card">${this.machineLoading ? t("ui.settingsGeneralPanel.loadingSelectedMachineFileAccessConfiguration", "Loading selected machine file access configuration…") : t("ui.settingsGeneralPanel.selectedMachineFileAccessConfigurationIsUnavailableReload", "Selected machine file access configuration is unavailable. Reload before saving file/upload settings.")}</div>` : html`
          <div class="config-path-card">
            <span>${t("ui.settingsGeneralPanel.selectedMachineConfigurationFile", "Selected machine configuration file")}</span>
            <code>${config.path}</code>
            <small>${config.exists ? t("ui.settingsGeneralPanel.existingFile", "Existing file") : t("ui.settingsGeneralPanel.fileWillBeCreatedOnSave", "File will be created on save")}</small>
          </div>
          <form class="config-form" @submit=${(event: Event) => { void this.saveMachineAccessConfig(event); }}>
            <label class="field">
              <span class="field-heading">
                <span>${t("ui.settingsGeneralPanel.externalFilesystemRoots", "External filesystem roots")}</span>
              </span>
              <textarea .value=${this.machineDraft.allowedPathsText} rows="4" placeholder="~/SDKs&#10;/opt/reference" spellcheck="false" @input=${(event: Event) => { this.updateMachineDraft({ allowedPathsText: textAreaValue(event) }); }}></textarea>
              <small>${t("ui.settingsGeneralPanel.allowedPathsHint", "Directories on {machine} allowed for absolute-path @ completion and file reads outside the workspace. Enter one absolute path, Windows absolute path, or ~ path per line. Leave blank to deny external paths by default.", { machine: this.targetLabel })}</small>
            </label>

            <label class="field">
              <span class="field-heading">
                <span>${t("ui.settingsGeneralPanel.defaultUploadFolder", "Default upload folder")}</span>
              </span>
              <input .value=${this.machineDraft.uploadDefaultFolder} placeholder=${DEFAULT_WORKSPACE_UPLOADS_FOLDER} autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateMachineDraft({ uploadDefaultFolder: inputValue(event) }); }}>
              <small>${this.targetLabel} ${t("ui.main.6c59b22a428d", ". Leave empty to use PI WEB's default")} <code>${DEFAULT_WORKSPACE_UPLOADS_FOLDER}</code>。</small>
            </label>

            <label class="field">
              <span class="field-heading">
                <span>${t("ui.main.43cec1f44f0e", "Default attachments folder")}</span>
              </span>
              <input .value=${this.machineDraft.attachmentDefaultFolder} placeholder=${DEFAULT_WORKSPACE_ATTACHMENTS_FOLDER} autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateMachineDraft({ attachmentDefaultFolder: inputValue(event) }); }}>
              <small>${this.targetLabel} ${t("ui.main.8d63c65c6988", ". Leave empty to use PI WEB's default")} <code>${DEFAULT_WORKSPACE_ATTACHMENTS_FOLDER}</code>。</small>
            </label>

            ${this.renderMachineEffectiveConfig()}

            <footer class="form-actions">
              <button class="primary" ?disabled=${this.machineLoading || this.saving}>${this.saving ? t("ui.settingsGeneralPanel.saving", "Saving…") : t("ui.settingsGeneralPanel.saveFileUploadConfiguration", "Save file/upload configuration")}</button>
            </footer>
          </form>
        `}
      </section>
    `;
  }

  private panelNotices(): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    const gatewayError = this.gatewayLocalError || this.error;
    if (gatewayError !== "") notices.push({ type: "error", title: t("ui.settingsGeneralPanel.gatewayServer", "Gateway server"), content: gatewayError });
    if (this.savedMessage !== "") notices.push({ type: "success", content: this.savedMessage });
    return notices;
  }

  private renderMachineMessages(): TemplateResult | null {
    const error = this.machineLocalError || this.machineError;
    if (error === "") return null;
    return html`<div class="message error-message">${error}</div>`;
  }

  private renderOverrideBadge(key: keyof PiWebConfigEnvOverrides): TemplateResult | null {
    if (this.configResponse?.envOverrides[key] !== true) return null;
    return html`<span class="override-badge">${t("ui.settingsGeneralPanel.environmentOverrides", "Environment overrides")}</span>`;
  }

  private renderGatewayEffectiveConfig(): TemplateResult {
    const effective = this.configResponse?.effectiveConfig ?? {};
    return html`
      <section class="effective-card" aria-label=${t("ui.settingsGeneralPanel.effectiveConfigurationSummary", "Effective configuration summary")}>
        <h3>${t("ui.settingsGeneralPanel.effectiveGatewayConfigurationAfterEnvironmentOverrides", "Effective gateway configuration after environment overrides")}</h3>
        <dl>
          <div><dt>${t("ui.settingsGeneralPanel.hostAddress", "Host address")}</dt><dd>${effective.host ?? html`<span class="muted">${t("ui.settingsGeneralPanel.default127001", "Default 127.0.0.1")}</span>`}</dd></div>
          <div><dt>${t("ui.settingsGeneralPanel.port", "Port")}</dt><dd>${effective.port ?? html`<span class="muted">${t("ui.settingsGeneralPanel.default8504", "Default 8504")}</span>`}</dd></div>
          <div><dt>${t("ui.settingsGeneralPanel.allowedHosts", "Allowed hosts")}</dt><dd>${formatAllowedHosts(effective.allowedHosts)}</dd></div>
        </dl>
      </section>
    `;
  }

  private renderMachineEffectiveConfig(): TemplateResult {
    const effective = this.machineConfigResponse?.effectiveConfig ?? {};
    return html`
      <section class="effective-card" aria-label=${t("ui.settingsGeneralPanel.selectedMachineEffectiveFileAccessAndUploadSummary", "Selected machine effective file access and upload summary")}>
        <h3>${t("ui.settingsGeneralPanel.selectedMachineEffectiveConfiguration", "Selected machine effective configuration")}</h3>
        <dl>
          <div><dt>${t("ui.settingsGeneralPanel.externalRoots", "External roots")}</dt><dd>${formatAllowedPaths(effective.pathAccess?.allowedPaths)}</dd></div>
          <div><dt>${t("ui.settingsGeneralPanel.uploadFolder", "Upload folder")}</dt><dd>${effective.uploads?.defaultFolder ?? html`<span class="muted">${t("ui.settingsShortcutsPanel.default", "Default")} ${DEFAULT_WORKSPACE_UPLOADS_FOLDER}</span>`}</dd></div>
          <div><dt>${t("ui.main.c7057e130dae", "Attachments folder")}</dt><dd>${effective.attachments?.defaultFolder ?? html`<span class="muted">${t("ui.settingsShortcutsPanel.default", "Default")} ${DEFAULT_WORKSPACE_ATTACHMENTS_FOLDER}</span>`}</dd></div>
        </dl>
      </section>
    `;
  }

  private reloadAll(): void {
    void this.onReload?.();
    void this.onReloadMachine?.();
  }

  private async saveGatewayConfig(event: Event): Promise<void> {
    event.preventDefault();
    this.gatewayLocalError = "";
    try {
      await this.onSave?.(gatewayServerConfigFromDraft(this.gatewayDraft, this.configResponse?.config ?? {}));
    } catch (error) {
      this.gatewayLocalError = errorMessage(error);
    }
  }

  private async saveMachineAccessConfig(event: Event): Promise<void> {
    event.preventDefault();
    this.machineLocalError = "";
    try {
      await this.onSaveMachineConfig?.(machineAccessConfigPatchFromDraft(this.machineDraft));
    } catch (error) {
      this.machineLocalError = errorMessage(error);
    }
  }

  private updateGatewayDraft(patch: Partial<GatewayServerConfigDraft>): void {
    this.gatewayDraft = { ...this.gatewayDraft, ...patch };
    this.gatewayLocalError = "";
  }

  private updateMachineDraft(patch: Partial<MachineAccessConfigDraft>): void {
    this.machineDraft = { ...this.machineDraft, ...patch };
    this.machineLocalError = "";
  }

  static override styles = css`
    :host { display: block; }
    .card-heading { display: grid; gap: 6px; min-width: 0; }
    h3, p { margin: 0; }
    h3 { font-size: 13px; line-height: 1.3; }
    p { color: var(--pi-muted); line-height: 1.45; }
    button, input, select, textarea { font: inherit; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .settings-sections { display: grid; gap: 14px; }
    .settings-card, .message, .loading-card, .config-path-card, .effective-card { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .settings-card { display: grid; gap: 14px; }
    .message { margin-bottom: 12px; }
    .settings-card .message { margin-bottom: 0; }
    .error-message { border-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); }
    .loading-card { color: var(--pi-muted); }
    .config-path-card { display: grid; gap: 5px; }
    .config-path-card span, .field-heading, dt { color: var(--pi-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .config-path-card small, .field small { color: var(--pi-muted); }
    .config-form { display: grid; gap: 14px; }
    .field { display: grid; gap: 7px; }
    .field-heading { display: flex; align-items: center; gap: 8px; }
    input, select, textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); padding: 9px 10px; outline: none; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
    input:focus, select:focus, textarea:focus { border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent-border); }
    textarea { resize: vertical; min-height: 94px; font-family: var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    textarea:disabled { opacity: .55; }
    .override-badge { border: 1px solid var(--pi-warning-border); border-radius: 999px; color: var(--pi-warning); background: var(--pi-warning-surface); padding: 2px 7px; font-size: 11px; font-weight: 600; text-transform: none; }
    .effective-card { display: grid; gap: 10px; }
    .effective-card dl { display: grid; gap: 8px; margin: 0; }
    .effective-card dl > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; align-items: baseline; }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .muted { color: var(--pi-muted); }
    .form-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }
    .primary { border-color: var(--pi-accent); background: var(--pi-selection-bg); color: var(--pi-text-bright); }

    @media (max-width: 760px) {
      .effective-card dl > div { grid-template-columns: minmax(0, 1fr); gap: 3px; }
    }
  `;
}

function formatAllowedHosts(value: PiWebConfigValues["allowedHosts"]): string | TemplateResult {
  if (value === true) return t("ui.settingsGeneralPanel.anyHost", "Any host");
  if (Array.isArray(value)) return value.length === 0 ? html`<span class="muted">${t("ui.settingsGeneralPanel.noneListed", "None listed")}</span>` : value.join(", ");
  return html`<span class="muted">${t("ui.settingsGeneralPanel.notSet", "Not set")}</span>`;
}

function formatAllowedPaths(value: string[] | undefined): string | TemplateResult {
  if (value === undefined || value.length === 0) return html`<span class="muted">${t("ui.settingsGeneralPanel.externalPathsDenied", "External paths denied")}</span>`;
  return value.join(", ");
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

function selectValue(event: Event): string {
  return event.target instanceof HTMLSelectElement ? event.target.value : "";
}

function textAreaValue(event: Event): string {
  return event.target instanceof HTMLTextAreaElement ? event.target.value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

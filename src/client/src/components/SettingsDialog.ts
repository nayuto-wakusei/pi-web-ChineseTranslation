import { uiDialogStyles, uiSelectionStyles } from "./ui/dialogStyles";
import { stylesheetIntegrationCapability } from "../plugins/styles";
import { t } from "../i18n";
import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./ModalSurface";
import type { AppAction } from "../actions";
import { configApi, piPackagesApi, pluginsApi, type Machine, type MachineRuntime, type PiPackageMutationResponse, type PiPackageScope, type PiPackagesResponse, type PiWebConfigResponse, type PiWebConfigValues, type PiWebPluginsResponse } from "../api";
import type { SettingsSection } from "../settingsRoute";
import "./settings/SettingsGeneralPanel";
import "./settings/SettingsThemePanel";
import type { QualifiedThemeContribution } from "../plugins/types";
import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from "../theme";
import "./settings/SettingsSessiondPanel";
import "./settings/SettingsPackagesPanel";
import "./settings/SettingsPluginsPanel";
import "./settings/SettingsShortcutsPanel";
import { friendlyPiPackageErrorMessage, isPiPackageManagementUnsupported, piPackageManagementSupport, piPackageManagementSupportKey, piPackageMutationFollowUpMessage, piPackagesResponseAfterMutation, piPackageTargetLabel, shouldRefreshGatewayPluginsAfterPiPackageMutation, type PiPackageManagementSupport, type PiPackageOperationState, type PiPackageTargetContext } from "./settings/piPackageSettings";
import { loadGatewaySettingsData, loadPiPackagesData } from "./settings/settingsDataLoading";
import { mergeSelectedMachineAccessConfig } from "./settings/settingsMachineAccessConfig";
import { agentProfileSettingsSupport, friendlySelectedMachineSettingsErrorMessage, isAgentProfileSettingsSupported, isSelectedMachineSettingsUnsupported, selectedMachineSettingsSupport, selectedMachineSettingsSupportKey, settingsMachineTarget, settingsMachineTargetLabel, type AgentProfileSettingsSupport, type SelectedMachineSettingsSupport, type SettingsMachineTarget } from "./settings/settingsMachineTarget";
import { mergeSelectedMachinePluginConfig, pluginEnabledConfigPatch } from "./settings/settingsPluginConfig";
import { mergeSelectedMachineSessiondConfig } from "./settings/settingsSessiondConfig";
import { pluginLifecycleSupport } from "./settings/settingsMachineTarget";

@customElement("settings-dialog")
export class SettingsDialog extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) section: SettingsSection = "general";
  @property({ attribute: false }) actions: AppAction[] = [];
  @property({ attribute: false }) themes: readonly QualifiedThemeContribution[] = [];
  @property({ attribute: false }) themePreference: ThemePreference = DEFAULT_THEME_PREFERENCE;
  @property() activeThemeId = "";
  @property({ type: Boolean }) hasLocalThemeOverride = false;
  @property({ attribute: false }) onUseLocalTheme?: (preference: ThemePreference) => void;
  @property({ attribute: false }) onUseDefaultTheme?: () => void;
  @property({ attribute: false }) machine: Machine | undefined;
  @property({ attribute: false }) machineRuntime: MachineRuntime | undefined;
  @property({ attribute: false }) onNavigate?: (section: SettingsSection) => void;
  @property({ attribute: false }) onClose?: () => void;
  @property({ attribute: false }) onConfigSaved?: (config: PiWebConfigValues) => void;
  @property({ attribute: false }) onRefreshMachineRuntime?: (machineId: string) => void | Promise<void>;
  @state() private configResponse: PiWebConfigResponse | undefined;
  @state() private accessConfigResponse: PiWebConfigResponse | undefined;
  @state() private sessiondConfigResponse: PiWebConfigResponse | undefined;
  @state() private pluginsResponse: PiWebPluginsResponse | undefined;
  @state() private selectedPluginConfigResponse: PiWebConfigResponse | undefined;
  @state() private selectedPluginsResponse: PiWebPluginsResponse | undefined;
  @state() private packagesResponse: PiPackagesResponse | undefined;
  @state() private loading = true;
  @state() private accessLoading = true;
  @state() private sessiondLoading = true;
  @state() private pluginLoading = true;
  @state() private packageLoading = true;
  @state() private saving = false;
  @state() private packageOperation: PiPackageOperationState | undefined;
  @state() private error = "";
  @state() private accessError = "";
  @state() private sessiondError = "";
  @state() private pluginError = "";
  @state() private packageError = "";
  @state() private savedMessage = "";
  @state() private packageMessage = "";
  private savedMessageTimer: number | undefined;
  private loadRequestSeq = 0;
  private accessLoadRequestSeq = 0;
  private sessiondLoadRequestSeq = 0;
  private pluginLoadRequestSeq = 0;
  private packageLoadRequestSeq = 0;
  private packageMutationSeq = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadConfig();
    void this.loadAccessConfigForTarget();
    void this.reloadSessiondState();
    void this.loadPluginsForTarget();
    void this.loadPackagesForTarget();
  }

  override disconnectedCallback(): void {
    if (this.savedMessageTimer !== undefined) window.clearTimeout(this.savedMessageTimer);
    this.savedMessageTimer = undefined;
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    const currentTarget = this.settingsTarget();
    if (changed.has("machine")) {
      const previousTarget = settingsMachineTarget(changed.get("machine"));
      if (previousTarget.id !== currentTarget.id) {
        this.resetAccessStateForTargetChange();
        if (this.isConnected) void this.loadAccessConfigForTarget(currentTarget);
        this.resetSessiondStateForTargetChange();
        if (this.isConnected) void this.loadSessiondConfigForTarget(currentTarget);
        this.resetPluginStateForTargetChange();
        if (this.isConnected) void this.loadPluginsForTarget(currentTarget);
        this.resetPackageStateForTargetChange();
        if (this.isConnected) void this.loadPackagesForTarget(currentTarget);
        return;
      }
    }

    if (!changed.has("machineRuntime")) return;
    const lifecycleChanged = selectedMachineSettingsSupportKey(pluginLifecycleSupport(currentTarget, changed.get("machineRuntime")))
      !== selectedMachineSettingsSupportKey(pluginLifecycleSupport(currentTarget, this.machineRuntime));
    if (this.selectedMachineSettingsSupportNeedsReload(changed.get("machineRuntime"), currentTarget)) {
      this.resetAccessStateForTargetChange();
      if (this.isConnected) void this.loadAccessConfigForTarget(currentTarget);
      this.resetSessiondStateForTargetChange();
      if (this.isConnected) void this.loadSessiondConfigForTarget(currentTarget);
    }
    if (lifecycleChanged) {
      this.resetPluginStateForTargetChange();
      if (this.isConnected) void this.loadPluginsForTarget(currentTarget);
    }
    if (!this.packageManagementSupportNeedsReload(changed.get("machineRuntime"), currentTarget)) return;
    this.resetPackageStateForTargetChange();
    if (this.isConnected) void this.loadPackagesForTarget(currentTarget);
  }

  override render(): TemplateResult {
    return html`
      <modal-surface .onClose=${() => this.onClose?.()} .busy=${this.saving} .label=${t("ui.settingsDialog.piWebSettings", "PI WEB settings")}>
          <header class="settings-header">
            <div>
              <span class="eyebrow">${t("ui.settingsDialog.settings", "Settings")}</span>
              <h1>PI WEB</h1>
            </div>
            <button class="close-button" title="${t("ui.settingsDialog.closeSettings", "Close settings")}" aria-label="${t("ui.settingsDialog.closeSettings", "Close settings")}" @click=${() => this.onClose?.()}>×</button>
          </header>
          <div class="settings-body">
            <nav class="settings-nav" aria-label="${t("ui.settingsDialog.settingsSections", "Settings sections")}">
              ${this.renderNavButton("general", t("client.actions.general.835b70", "General"), t("ui.settingsDialog.gatewayAndSelectedMachine", "Gateway and selected machine"))}
              ${this.renderNavButton("sessiond", t("bundled.updates.session.daemon.757666", "Session daemon"), t("ui.settingsDialog.selectedMachine", "Selected machine"))}
              ${this.renderNavButton("packages", t("bundled.updates.pi.package.feed18", "Pi package"), t("ui.settingsDialog.selectedMachine", "Selected machine"))}
              ${this.renderNavButton("plugins", t("client.machinePluginLoadCoordinator.pi.web.plugins.54b78f", "PI WEB plugins"), t("ui.settingsDialog.selectedMachine", "Selected machine"))}
              ${this.renderNavButton("shortcuts", t("ui.settingsDialog.keyboard", "Keyboard"), t("ui.settingsDialog.gatewayShortcuts", "Gateway shortcuts"))}
            </nav>
            <main class="settings-content">
              ${this.renderActiveSection()}
            </main>
          </div>
      </modal-surface>
    `;
  }

  private renderActiveSection(): TemplateResult {
    // Keep the section -> panel routing in sync with the public
    // `activeSettingsPanelTag` seam below, which tests assert against instead of
    // scraping this template's markup.
    if (this.section === "sessiond") {
      return html`
        <settings-sessiond-panel
          .configResponse=${this.sessiondConfigResponse}
          .loading=${this.sessiondLoading}
          .saving=${this.saving}
          .error=${this.sessiondError}
          .savedMessage=${this.savedMessage}
          .targetLabel=${settingsMachineTargetLabel(this.settingsTarget())}
          .activeAgentProfile=${this.machineRuntime?.components?.sessiond.activeAgentProfile}
          .agentProfileSupport=${this.agentProfileSettingsSupport()}
          .onReload=${() => this.reloadSessiondState()}
          .onSave=${(config: PiWebConfigValues) => this.saveSessiondConfig(config)}
        ></settings-sessiond-panel>
      `;
    }
    if (this.section === "shortcuts") {
      return html`
        <settings-shortcuts-panel
          .actions=${this.actions}
          .configResponse=${this.configResponse}
          .loading=${this.loading}
          .saving=${this.saving}
          .error=${this.error}
          .savedMessage=${this.savedMessage}
          .onReload=${() => this.loadConfig()}
          .onSave=${(config: PiWebConfigValues) => this.saveConfig(config)}
        ></settings-shortcuts-panel>
      `;
    }
    if (this.section === "packages") {
      return html`
        <settings-packages-panel
          .packagesResponse=${this.packagesResponse}
          .targetMachine=${this.packageTarget()}
          .managementSupport=${this.packageManagementSupport()}
          .loading=${this.packageLoading}
          .operation=${this.packageOperation}
          .error=${this.packageError}
          .operationMessage=${this.packageMessage}
          .onReload=${() => this.loadPackagesForTarget()}
          .onInstallPackage=${(source: string) => this.installPiPackage(source)}
          .onRemovePackage=${(source: string, scope: PiPackageScope) => this.removePiPackage(source, scope)}
          .onUpdatePackage=${(source?: string) => this.updatePiPackage(source)}
        ></settings-packages-panel>
      `;
    }
    if (this.section === "plugins") {
      return html`
        <settings-plugins-panel
          .configResponse=${this.selectedPluginConfigResponse}
          .pluginsResponse=${this.selectedPluginsResponse}
          .loading=${this.pluginLoading}
          .saving=${this.saving}
          .recoveryCommandsSupported=${pluginLifecycleSupport(this.settingsTarget(), this.machineRuntime).state === "supported"}
          .error=${this.pluginError}
          .savedMessage=${this.savedMessage}
          .targetLabel=${settingsMachineTargetLabel(this.settingsTarget())}
          .onReload=${() => this.loadPluginsForTarget()}
          .onTogglePlugin=${(pluginId: string, enabled: boolean) => this.togglePlugin(pluginId, enabled)}
        ></settings-plugins-panel>
      `;
    }
    return html`
      <settings-general-panel
        .configResponse=${this.configResponse}
        .machineConfigResponse=${this.accessConfigResponse}
        .loading=${this.loading}
        .machineLoading=${this.accessLoading}
        .saving=${this.saving}
        .error=${this.error}
        .machineError=${this.accessError}
        .savedMessage=${this.savedMessage}
        .targetLabel=${settingsMachineTargetLabel(this.settingsTarget())}
        .onReload=${() => this.loadConfig()}
        .onReloadMachine=${() => this.loadAccessConfigForTarget()}
        .onSave=${(config: PiWebConfigValues) => this.saveConfig(config)}
        .onSaveMachineConfig=${(config: PiWebConfigValues) => this.saveMachineAccessConfig(config)}
      >
        <settings-theme-panel
          slot="appearance"
          .themes=${this.themes}
          .preference=${this.themePreference}
          .defaultPreference=${this.configResponse?.effectiveConfig.defaultTheme ?? DEFAULT_THEME_PREFERENCE}
          .activeThemeId=${this.activeThemeId}
          .hasLocalOverride=${this.hasLocalThemeOverride}
          .loading=${this.loading || this.configResponse === undefined}
          .saving=${this.saving}
          .onUseLocal=${this.onUseLocalTheme}
          .onUseDefault=${this.onUseDefaultTheme}
          .onSetDefault=${(preference: ThemePreference) => this.saveDefaultTheme(preference)}
        ></settings-theme-panel>
      </settings-general-panel>
    `;
  }

  private renderNavButton(section: SettingsSection, label: string, detail: string): TemplateResult {
    const selected = this.section === section;
    return html`
      <button class=${selected ? "selected" : ""} aria-current=${selected ? "page" : "false"} @click=${() => { this.navigate(section); }}>
        <strong>${label}</strong>
        <small>${detail}</small>
      </button>
    `;
  }

  private navigate(section: SettingsSection): void {
    this.onNavigate?.(section);
  }

  private async loadConfig(): Promise<void> {
    const requestSeq = ++this.loadRequestSeq;
    this.loading = true;
    this.error = "";
    try {
      const result = await loadGatewaySettingsData({
        loadConfig: () => configApi.config(),
        loadPlugins: () => pluginsApi.plugins(),
      });
      if (!this.isCurrentLoad(requestSeq)) return;

      if (result.config !== undefined) {
        this.configResponse = result.config;
        this.onConfigSaved?.(result.config.effectiveConfig);
      }
      if (result.plugins !== undefined) this.pluginsResponse = result.plugins;
      this.error = result.error;
    } finally {
      if (this.isCurrentLoad(requestSeq)) this.loading = false;
    }
  }

  private async loadAccessConfigForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.accessLoadRequestSeq;
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.accessConfigResponse = undefined;
      this.accessLoading = false;
      this.accessError = support.message ?? t("ui.settingsDialog.doesNotSupportSelectedMachineSettings", "{value1} does not support selected-machine settings.", { value1: settingsMachineTargetLabel(target) });
      return;
    }
    this.accessLoading = true;
    this.accessError = "";
    try {
      const response = await configApi.config(target.id);
      if (!this.isCurrentAccessLoad(requestSeq, target)) return;
      this.accessConfigResponse = response;
    } catch (error) {
      if (this.isCurrentAccessLoad(requestSeq, target)) {
        this.accessError = t("ui.settingsDialog.failedToLoadFileAccessUploadConfigurationFrom", "Failed to load file access/upload configuration from {value1}: {value2}", { value1: settingsMachineTargetLabel(target), value2: friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target) });
      }
    } finally {
      if (this.isCurrentAccessLoad(requestSeq, target)) this.accessLoading = false;
    }
  }

  private async reloadSessiondState(target = this.settingsTarget()): Promise<void> {
    await Promise.all([
      this.loadSessiondConfigForTarget(target),
      this.onRefreshMachineRuntime?.(target.id),
    ]);
  }

  private async loadSessiondConfigForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.sessiondLoadRequestSeq;
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.sessiondConfigResponse = undefined;
      this.sessiondLoading = false;
      this.sessiondError = support.message ?? t("ui.settingsDialog.doesNotSupportSelectedMachineSettings", "{value1} does not support selected-machine settings.", { value1: settingsMachineTargetLabel(target) });
      return;
    }
    this.sessiondLoading = true;
    this.sessiondError = "";
    try {
      const response = await configApi.config(target.id);
      if (!this.isCurrentSessiondLoad(requestSeq, target)) return;
      this.sessiondConfigResponse = response;
    } catch (error) {
      if (this.isCurrentSessiondLoad(requestSeq, target)) {
        this.sessiondError = t("ui.settingsDialog.failedToLoadSessionDaemonConfigurationFrom", "Failed to load session daemon configuration from {value1}: {value2}", { value1: settingsMachineTargetLabel(target), value2: friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target) });
      }
    } finally {
      if (this.isCurrentSessiondLoad(requestSeq, target)) this.sessiondLoading = false;
    }
  }

  private async loadPluginsForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.pluginLoadRequestSeq;
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.selectedPluginConfigResponse = undefined;
      this.selectedPluginsResponse = undefined;
      this.pluginLoading = false;
      this.pluginError = support.message ?? t("ui.settingsDialog.doesNotSupportSelectedMachineSettings", "{value1} does not support selected-machine settings.", { value1: settingsMachineTargetLabel(target) });
      return;
    }
    this.pluginLoading = true;
    this.pluginError = "";
    try {
      const lifecycleSupport = pluginLifecycleSupport(target, this.machineRuntime);
      if (isSelectedMachineSettingsUnsupported(lifecycleSupport)) {
        try {
          const config = await configApi.config(target.id);
          if (!this.isCurrentPluginLoad(requestSeq, target)) return;
          this.selectedPluginConfigResponse = config;
          this.selectedPluginsResponse = undefined;
          this.pluginError = lifecycleSupport.message ?? t("ui.main.f4f3f5e99cce", "{arg0} does not support plugin lifecycle diagnostics.", { arg0: settingsMachineTargetLabel(target) });
        } catch (error) {
          if (!this.isCurrentPluginLoad(requestSeq, target)) return;
          this.pluginError = t("ui.main.93db7a95336e", "Failed to load PI WEB plugin configuration from {arg0}: {arg1}; {arg2}", { arg0: settingsMachineTargetLabel(target), arg1: friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target), arg2: lifecycleSupport.message ?? t("ui.main.2de7706b69b4", "plugin lifecycle diagnostics are unsupported") });
        }
        return;
      }
      const [config, plugins] = await Promise.allSettled([configApi.config(target.id), pluginsApi.plugins(target.id)]);
      if (!this.isCurrentPluginLoad(requestSeq, target)) return;

      const errors: string[] = [];
      if (config.status === "fulfilled") this.selectedPluginConfigResponse = config.value;
      else errors.push(t("ui.shared.e759c5a58cb4", "Config: {configPath}", { configPath: friendlySelectedMachineSettingsErrorMessage(errorMessage(config.reason), target) }));

      if (plugins.status === "fulfilled") this.selectedPluginsResponse = plugins.value;
      else errors.push(t("ui.settingsDataLoading.piWebPlugins", "PI WEB plugins: {reason}", { reason: friendlySelectedMachineSettingsErrorMessage(errorMessage(plugins.reason), target) }));

      this.pluginError = errors.length === 0 ? "" : t("ui.settingsDialog.failedToLoadPiWebPluginSettingsFrom", "Failed to load PI WEB plugin settings from {value1}: {join}", { value1: settingsMachineTargetLabel(target), join: errors.join("；") });
    } finally {
      if (this.isCurrentPluginLoad(requestSeq, target)) this.pluginLoading = false;
    }
  }

  private async loadPackagesForTarget(target = this.packageTarget()): Promise<void> {
    const requestSeq = ++this.packageLoadRequestSeq;
    this.packageLoading = true;
    this.packageError = "";
    this.packageMessage = "";
    try {
      const result = await loadPiPackagesData(target, (targetId) => piPackagesApi.packages(targetId), this.packageManagementSupport(target));
      if (!this.isCurrentPackageLoad(requestSeq, target)) return;

      this.packagesResponse = result.packagesResponse;
      this.packageError = result.error;
    } finally {
      if (this.isCurrentPackageLoad(requestSeq, target)) this.packageLoading = false;
    }
  }

  private async togglePlugin(pluginId: string, enabled: boolean): Promise<void> {
    if (pluginId === REQUIRED_TERMINAL_PLUGIN_ID || this.selectedPluginsResponse?.plugins.find(({ id }) => id === pluginId)?.required === true) return;
    if (this.saving) return;
    const target = this.settingsTarget();
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.pluginError = support.message ?? t("ui.settingsDialog.doesNotSupportSelectedMachineSettings", "{value1} does not support selected-machine settings.", { value1: settingsMachineTargetLabel(target) });
      return;
    }
    if (this.selectedPluginConfigResponse === undefined) {
      this.pluginError = t("ui.settingsDialog.pluginConfigurationForIsNotLoadedReloadBefore", "Plugin configuration for {value1} is not loaded. Reload before changing plugin activation.", { value1: settingsMachineTargetLabel(target) });
      return;
    }
    const patch = pluginEnabledConfigPatch(this.selectedPluginConfigResponse.config, pluginId, enabled);
    this.saving = true;
    this.pluginError = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(patch, target.id);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.selectedPluginConfigResponse = response;
      if (target.kind === "local" && this.configResponse !== undefined) {
        this.configResponse = mergeSelectedMachinePluginConfig(this.configResponse, response);
        this.onConfigSaved?.(this.configResponse.effectiveConfig);
      }
      const lifecycleSupport = pluginLifecycleSupport(target, this.machineRuntime);
      let pluginRefreshError: string | undefined;
      if (isSelectedMachineSettingsUnsupported(lifecycleSupport)) {
        this.selectedPluginsResponse = undefined;
        pluginRefreshError = lifecycleSupport.message ?? t("ui.main.f4f3f5e99cce", "{arg0} does not support plugin lifecycle diagnostics.", { arg0: settingsMachineTargetLabel(target) });
      } else {
        pluginRefreshError = await this.refreshPluginsForTarget(target);
      }
      if (!this.isCurrentSettingsTarget(target)) return;
      if (pluginRefreshError !== undefined) this.pluginError = pluginRefreshError;
      this.showSavedMessage();
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) {
        this.pluginError = t("ui.settingsDialog.failedToSavePiWebPluginConfigurationOn", "Failed to save PI WEB plugin configuration on {value1}: {value2}", { value1: settingsMachineTargetLabel(target), value2: friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target) });
      }
    } finally {
      this.saving = false;
    }
  }

  private async saveConfig(config: PiWebConfigValues): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.error = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(config);
      this.configResponse = response;
      this.onConfigSaved?.(response.effectiveConfig);
      this.showSavedMessage();
    } catch (error) {
      this.error = t("ui.settingsDialog.failedToSaveConfiguration", "Failed to save configuration: {errorMessageerror}", { errorMessageerror: errorMessage(error) });
    } finally {
      this.saving = false;
    }
  }

  private async saveDefaultTheme(preference: ThemePreference): Promise<void> {
    if (this.saving) return;
    // Retire an older Reload result and read fresh gateway config so this
    // focused action does not replace other settings with the dialog's snapshot.
    this.loadRequestSeq += 1;
    this.loading = false;
    this.saving = true;
    this.error = "";
    this.savedMessage = "";
    try {
      const current = await configApi.config();
      const response = await configApi.saveConfig({ ...current.config, defaultTheme: preference });
      this.configResponse = response;
      this.onConfigSaved?.(response.effectiveConfig);
      this.showSavedMessage();
    } catch (error) {
      this.error = t("ui.settingsThemePanel.saveFailed", "Failed to save default theme: {message}", { message: errorMessage(error) });
    } finally {
      this.saving = false;
    }
  }

  private async saveMachineAccessConfig(config: PiWebConfigValues): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.accessError = support.message ?? t("ui.settingsDialog.doesNotSupportSelectedMachineSettings", "{value1} does not support selected-machine settings.", { value1: settingsMachineTargetLabel(target) });
      return;
    }
    this.saving = true;
    this.accessError = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(config, target.id);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.accessConfigResponse = response;
      if (target.kind === "local" && this.configResponse !== undefined) {
        this.configResponse = mergeSelectedMachineAccessConfig(this.configResponse, response);
        this.onConfigSaved?.(this.configResponse.effectiveConfig);
      }
      this.showSavedMessage();
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) {
        this.accessError = t("ui.settingsDialog.failedToSaveFileAccessUploadConfigurationOn", "Failed to save file access/upload configuration on {value1}: {value2}", { value1: settingsMachineTargetLabel(target), value2: friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target) });
      }
    } finally {
      this.saving = false;
    }
  }

  private async saveSessiondConfig(config: PiWebConfigValues): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.sessiondError = support.message ?? t("ui.settingsDialog.doesNotSupportSelectedMachineSettings", "{value1} does not support selected-machine settings.", { value1: settingsMachineTargetLabel(target) });
      return;
    }
    if (config.agent !== undefined) {
      const profileSupport = this.agentProfileSettingsSupport(target);
      if (!isAgentProfileSettingsSupported(profileSupport)) {
        this.sessiondError = profileSupport.message ?? t("ui.settingsDialog.doesNotSupportPiCompatibleAgentProfileSettings", "{value1} does not support Pi-compatible agent profile settings.", { value1: settingsMachineTargetLabel(target) });
        return;
      }
    }
    this.saving = true;
    this.sessiondError = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(config, target.id);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.sessiondConfigResponse = response;
      if (target.kind === "local" && this.configResponse !== undefined) this.configResponse = mergeSelectedMachineSessiondConfig(this.configResponse, response);
      this.showSavedMessage();
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) {
        this.sessiondError = t("ui.settingsDialog.failedToSaveSessionDaemonConfigurationOn", "Failed to save session daemon configuration on {value1}: {value2}", { value1: settingsMachineTargetLabel(target), value2: friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target) });
      }
    } finally {
      this.saving = false;
    }
  }

  private async installPiPackage(source: string): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation({ kind: "install", source }, t("ui.settingsDialog.installPiPackage", "Install Pi package"), target, () => piPackagesApi.install(source, target.id));
  }

  private async removePiPackage(source: string, scope: PiPackageScope): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation({ kind: "remove", source }, t("ui.settingsDialog.removePiPackage", "Remove Pi package"), target, () => piPackagesApi.remove(source, scope, target.id));
  }

  private async updatePiPackage(source?: string): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation(source === undefined ? { kind: "update-all" } : { kind: "update", source }, t("ui.settingsDialog.updatePiPackage", "Update Pi package"), target, () => piPackagesApi.update(source, target.id));
  }

  private async runPiPackageMutation(operation: PiPackageOperationState, label: string, target: PiPackageTargetContext, mutate: () => Promise<PiPackageMutationResponse>): Promise<void> {
    const support = this.packageManagementSupport(target);
    if (isPiPackageManagementUnsupported(support)) {
      this.packageError = support.message ?? t("ui.settingsDataLoading.doesNotSupportPiPackageManagement", "{piPackageTargetLabeltarget} does not support Pi package management.", { piPackageTargetLabeltarget: piPackageTargetLabel(target) });
      throw new Error(this.packageError);
    }
    if (this.saving) throw new Error(t("ui.settingsDialog.aSettingsOperationIsAlreadyRunning", "A settings operation is already running."));
    const requestSeq = ++this.packageMutationSeq;
    this.packageLoadRequestSeq += 1;
    this.packageLoading = false;
    this.saving = true;
    this.packageOperation = operation;
    this.packageError = "";
    this.packageMessage = "";
    try {
      const response = await mutate();
      if (!this.isCurrentPackageMutation(requestSeq, target)) return;
      this.packagesResponse = piPackagesResponseAfterMutation(response);
      const pluginRefreshError = shouldRefreshGatewayPluginsAfterPiPackageMutation(target) ? await this.refreshGatewayPlugins() : undefined;
      if (!this.isCurrentPackageMutation(requestSeq, target)) return;
      if (pluginRefreshError !== undefined) this.packageError = pluginRefreshError;
      this.packageMessage = piPackageMutationFollowUpMessage(response.action, target);
    } catch (error) {
      if (this.isCurrentPackageMutation(requestSeq, target)) this.packageError = t("ui.settingsDialog.failedOn", "{label} failed on {piPackageTargetLabeltarget}: {value3}", { piPackageTargetLabeltarget: piPackageTargetLabel(target), label: label, value3: friendlyPiPackageErrorMessage(errorMessage(error), target) });
      throw error;
    } finally {
      if (this.packageMutationSeq === requestSeq) {
        this.packageOperation = undefined;
        this.saving = false;
      }
    }
  }

  private async refreshGatewayPlugins(): Promise<string | undefined> {
    try {
      this.pluginsResponse = await pluginsApi.plugins();
      return undefined;
    } catch (error) {
      return t("ui.settingsDialog.failedToRefreshGatewayPiWebPlugins", "Failed to refresh gateway PI WEB plugins: {errorMessageerror}", { errorMessageerror: errorMessage(error) });
    }
  }

  private async refreshPluginsForTarget(target: SettingsMachineTarget): Promise<string | undefined> {
    try {
      const response = await pluginsApi.plugins(target.id);
      if (this.isCurrentSettingsTarget(target)) this.selectedPluginsResponse = response;
      return undefined;
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) this.selectedPluginsResponse = undefined;
      return t("ui.settingsDialog.configurationSavedButFailedToRefreshPiWeb", "Configuration saved, but failed to refresh PI WEB plugins from {value1}: {value2}", { value1: settingsMachineTargetLabel(target), value2: friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target) });
    }
  }

  private settingsTarget(): SettingsMachineTarget {
    return settingsMachineTarget(this.machine);
  }

  private packageTarget(): PiPackageTargetContext {
    return this.settingsTarget();
  }

  private selectedMachineSettingsSupport(target = this.settingsTarget()): SelectedMachineSettingsSupport {
    return selectedMachineSettingsSupport(target, this.machineRuntime);
  }

  private agentProfileSettingsSupport(target = this.settingsTarget()): AgentProfileSettingsSupport {
    return agentProfileSettingsSupport(target, this.machineRuntime);
  }

  private selectedMachineSettingsSupportNeedsReload(previousRuntime: MachineRuntime | undefined, target: SettingsMachineTarget): boolean {
    const previousSupport = selectedMachineSettingsSupport(target, previousRuntime);
    const currentSupport = this.selectedMachineSettingsSupport(target);
    return selectedMachineSettingsSupportKey(previousSupport) !== selectedMachineSettingsSupportKey(currentSupport);
  }

  private packageManagementSupport(target = this.packageTarget()): PiPackageManagementSupport {
    return piPackageManagementSupport(target, this.machineRuntime);
  }

  private packageManagementSupportNeedsReload(previousRuntime: MachineRuntime | undefined, target: PiPackageTargetContext): boolean {
    const previousSupport = piPackageManagementSupport(target, previousRuntime);
    const currentSupport = this.packageManagementSupport(target);
    if (piPackageManagementSupportKey(previousSupport) === piPackageManagementSupportKey(currentSupport)) return false;
    return previousSupport.state === "unsupported" || currentSupport.state === "unsupported";
  }

  private isCurrentLoad(requestSeq: number): boolean {
    return requestSeq === this.loadRequestSeq;
  }

  private isCurrentAccessLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.accessLoadRequestSeq && this.isCurrentSettingsTarget(target);
  }

  private isCurrentSessiondLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.sessiondLoadRequestSeq && this.isCurrentSettingsTarget(target);
  }

  private isCurrentPluginLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.pluginLoadRequestSeq && this.isCurrentSettingsTarget(target);
  }

  private isCurrentPackageLoad(requestSeq: number, target: PiPackageTargetContext): boolean {
    return requestSeq === this.packageLoadRequestSeq && this.isCurrentPackageTarget(target);
  }

  private isCurrentPackageMutation(requestSeq: number, target: PiPackageTargetContext): boolean {
    return requestSeq === this.packageMutationSeq && this.isCurrentPackageTarget(target);
  }

  private isCurrentPackageTarget(target: PiPackageTargetContext): boolean {
    return this.packageTarget().id === target.id;
  }

  private isCurrentSettingsTarget(target: SettingsMachineTarget): boolean {
    return this.settingsTarget().id === target.id;
  }

  private resetAccessStateForTargetChange(): void {
    this.accessLoadRequestSeq += 1;
    this.accessLoading = false;
    this.accessError = "";
    this.accessConfigResponse = undefined;
    this.savedMessage = "";
  }

  private resetSessiondStateForTargetChange(): void {
    this.sessiondLoadRequestSeq += 1;
    this.sessiondLoading = false;
    this.sessiondError = "";
    this.sessiondConfigResponse = undefined;
    this.savedMessage = "";
  }

  private resetPluginStateForTargetChange(): void {
    this.pluginLoadRequestSeq += 1;
    this.pluginLoading = false;
    this.pluginError = "";
    this.selectedPluginConfigResponse = undefined;
    this.selectedPluginsResponse = undefined;
    this.savedMessage = "";
  }

  private resetPackageStateForTargetChange(): void {
    const hadPackageOperation = this.packageOperation !== undefined;
    this.packageLoadRequestSeq += 1;
    this.packageMutationSeq += 1;
    this.packageLoading = false;
    this.packageOperation = undefined;
    this.packageMessage = "";
    this.packageError = "";
    this.packagesResponse = undefined;
    if (hadPackageOperation) this.saving = false;
  }

  private showSavedMessage(): void {
    this.savedMessage = t("ui.settingsDialog.configurationSaved", "Configuration saved.");
    if (this.savedMessageTimer !== undefined) window.clearTimeout(this.savedMessageTimer);
    this.savedMessageTimer = window.setTimeout(() => {
      if (this.savedMessage === t("ui.settingsDialog.configurationSaved", "Configuration saved.")) this.savedMessage = "";
      this.savedMessageTimer = undefined;
    }, 3000);
  }

  static override styles = [uiDialogStyles, uiSelectionStyles, css`
    @layer pi-web-base {
    :host { position: fixed; inset: 0; z-index: 30; color: var(--pi-text); font: 14px var(--pi-font, system-ui, sans-serif); }
    modal-surface { --modal-surface-backdrop-padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); --modal-surface-width: min(980px, 100%); --modal-surface-max-height: min(760px, 100%); --modal-surface-min-height: min(620px, 100%); --modal-surface-radius: 14px; }
    .settings-machine { display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 18px; border-bottom: 1px solid var(--pi-border); }
    .settings-machine label { font-size: 12px; font-weight: 700; }
    .settings-machine select { flex: 1 1 160px; max-width: 280px; background: var(--pi-bg); }
    .machine-status { color: var(--pi-muted); line-height: 1.35; }
    .machine-status.unavailable { color: var(--pi-warning); }
    .machine-scope { color: var(--pi-muted); font-size: 12px; }
    .machine-scope summary { cursor: pointer; }
    .machine-scope[open] { flex-basis: 100%; }
    .machine-scope p { margin: 8px 0 0; line-height: 1.45; }
    .machine-connection-error { flex-basis: 100%; margin: 0; font-size: 12px; line-height: 1.45; color: var(--pi-warning); overflow-wrap: anywhere; }
    .machine-scope summary:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
    .machine-switch-confirmation { flex: 0 0 auto; padding: 12px 16px; border-bottom: 1px solid var(--pi-warning-border); background: var(--pi-warning-surface); }
    .machine-switch-confirmation p { margin: 0 0 8px; }
    .machine-switch-confirmation button + button { margin-inline-start: 8px; }
    .settings-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 220px minmax(0, 1fr); }
    .settings-nav { min-height: 0; border-right: 1px solid var(--pi-border); background: var(--pi-surface); overflow: auto; }
    .settings-nav button { display: grid; justify-content: stretch; gap: 2px; }
    .settings-nav small { color: var(--pi-muted); }
    .settings-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    .settings-content { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; padding: 0; }

    @media (max-width: 760px) {
      modal-surface { --modal-surface-backdrop-padding: 0; --modal-surface-place-items: stretch; --modal-surface-width: 100%; --modal-surface-max-height: none; --modal-surface-min-height: 0; --modal-surface-border: 0; --modal-surface-radius: 0; }
      .settings-header { padding-top: env(safe-area-inset-top); }
      .settings-machine { padding: 10px 12px; }
      .settings-machine label { flex-basis: 100%; }
      .settings-machine select { max-width: none; }
      .machine-scope { flex-basis: 100%; }
      .settings-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
      .settings-nav { display: flex; gap: 0; padding: 0; border-right: 0; border-bottom: 1px solid var(--pi-border); overflow-x: auto; overflow-y: hidden; }
      .settings-nav button { flex: 0 0 auto; width: auto; white-space: nowrap; border-inline-end: 1px solid var(--pi-border-muted); }
      .settings-nav small { display: none; }
      .settings-content { padding-bottom: env(safe-area-inset-bottom); }
    }
    }
  `];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type SettingsPanelTag =
  | "settings-general-panel"
  | "settings-sessiond-panel"
  | "settings-packages-panel"
  | "settings-plugins-panel"
  | "settings-shortcuts-panel";

/**
 * The single custom-element panel the settings dialog renders for a section.
 *
 * This is the public routing contract behind `renderActiveSection`: each section
 * maps to exactly one panel element and nothing else (no per-tab "scope note"
 * wrapper). Tests assert this mapping instead of inspecting the rendered
 * `TemplateResult`'s markup.
 */
export function activeSettingsPanelTag(section: SettingsSection): SettingsPanelTag {
  switch (section) {
    case "sessiond":
      return "settings-sessiond-panel";
    case "packages":
      return "settings-packages-panel";
    case "plugins":
      return "settings-plugins-panel";
    case "shortcuts":
      return "settings-shortcuts-panel";
    case "general":
      return "settings-general-panel";
  }
}
import { REQUIRED_TERMINAL_PLUGIN_ID } from "../../../shared/requiredTerminalPlugin";

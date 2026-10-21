import { t } from "../i18n";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state as litState } from "lit/decorators.js";
import type { AuthDialogState } from "../appState";
import type { AuthProviderOption, OAuthFlowState } from "../api";
import { LOCAL_MACHINE_ID } from "../machineKeys";
import { keyboardEventOriginatesFromNativeActivationControl } from "./keyboardEventTarget";
import { commandPickerStyles } from "./styles/commandPickerStyles";
import "./ModalSurface";
import type { ModalSurface } from "./ModalSurface";
import { scrollWhenSelected } from "./scrollWhenSelected";

interface AuthDialogOption {
  key: string;
  title: TemplateResult | string;
  detail: string;
  searchText: string;
  run: () => void;
}

@customElement("auth-dialog")
export class AuthDialog extends LitElement {
  @property({ attribute: false }) state?: AuthDialogState;
  @property({ attribute: false }) onChooseMethod?: (authType: "oauth" | "api_key") => void;
  @property({ attribute: false }) onSelectProvider?: (providerId: string, authType: "oauth" | "api_key") => void;
  @property({ attribute: false }) onApiKeyInput?: (value: string) => void;
  @property({ attribute: false }) onSaveApiKey?: () => void;
  @property({ attribute: false }) onLogoutProvider?: (providerId: string) => void;
  @property({ attribute: false }) onOAuthInput?: (value: string) => void;
  @property({ attribute: false }) onOAuthRespond?: (value?: string) => void;
  @property({ attribute: false }) onOAuthCancel?: () => void;
  @property({ attribute: false }) onCancel?: () => void;
  @query("modal-surface") private modalSurface?: ModalSurface;
  @litState() private selectedIndex = 0;
  @litState() private query = "";

  override render() {
    const state = this.state;
    if (state === undefined) return null;
    const busy = state.step === "apiKey" ? state.saving === true : state.step === "oauth" && state.responding === true;
    return html`
      <modal-surface .onClose=${() => { this.cancel(); }} .onBusyEscape=${state.step === "oauth" ? () => this.onOAuthCancel?.() : undefined} .busy=${busy} .initialFocus=${this.initialFocus(state)} .label=${this.dialogTitle(state)} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
          <header>
            <strong>${this.dialogTitle(state)}</strong>
            <button aria-label="${t("ui.common.close", "Close")}" title="${t("ui.common.close", "Close")}" @click=${() => { this.cancel(); }}>×</button>
          </header>
          ${this.renderBody(state)}
      </modal-surface>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (!changed.has("state")) return;
    if (authDialogStateStep(changed.get("state")) !== this.state?.step) {
      // Selection and search text are scoped to the visible option list:
      // entering a step starts at its first option with an empty query.
      this.selectedIndex = 0;
      this.query = "";
      return;
    }
    const options = this.state === undefined ? undefined : this.visibleOptions(this.state);
    if (options !== undefined) this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, options.length - 1));
  }

  protected override updated(changed: PropertyValues): void {
    if (!changed.has("state")) return;
    const previousStep = authDialogStateStep(changed.get("state"));
    if (previousStep === undefined) return;
    const currentStep = this.state?.step;
    const stepChanged = previousStep !== currentStep;
    const oauthInteractionChanged = previousStep === "oauth"
      && currentStep === "oauth"
      && oauthInteractionKey(changed.get("state")) !== oauthInteractionKey(this.state);
    // Step changes and same-step OAuth interaction changes can replace the
    // focused control. Reapply the surface's input-or-dialog focus contract so
    // keyboard events never become stranded on the page.
    if (stepChanged || oauthInteractionChanged) this.modalSurface?.focusDialog();
  }

  private dialogTitle(state: AuthDialogState): string {
    const scope = state.target.projectName === undefined ? "" : ` · ${state.target.projectName}`;
    switch (state.step) {
      case "method": return t("ui.authDialog.configureProviderAuthentication", "Configure provider authentication{scope}", { scope: scope });
      case "providers": return `${state.authType === undefined ? t("ui.authDialog.selectProviderAuthentication", "Select provider authentication") : state.authType === "oauth" ? t("ui.authDialog.selectSubscriptionProvider", "Select subscription provider") : t("ui.authDialog.selectApiKeyProvider", "Select API key provider")}${scope}`;
      case "apiKey": return t("ui.authDialog.apiKeyFor", "API key for {name}{scope}", { name: state.provider.name, scope: scope });
      case "oauth": return t("ui.authDialog.logInTo", "Log in to {providerName}{scope}", { providerName: state.flow.providerName, scope: scope });
      case "logout": return t("ui.authDialog.removeSavedProviderAuthentication", "Remove saved provider authentication{scope}", { scope: scope });
    }
  }

  private renderBody(state: AuthDialogState) {
    const credentialScope = state.target.projectName === undefined ? t("ui.authDialog.currentMode", "current mode") : t("ui.authDialog.currentProject", "current project");
    switch (state.step) {
      case "method":
      case "providers":
      case "logout": return this.renderOptionList(state, credentialScope);
      case "apiKey": return html`
        <div class="form">
          <p>${t("ui.toolExecutionView.input", "Input")} <strong>${state.provider.name}</strong> ${t("ui.main.cc6c809fa44c", " API key. It will be stored in ")}${credentialScope}${t("ui.main.1ddab1c2493b", " credentials file.")}</p>
          <input type="password" autocomplete="off" placeholder="API key" .value=${state.value} @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.onApiKeyInput?.(event.target.value); }}>
          ${state.error !== undefined && state.error !== "" ? html`<div class="error-text">${state.error}</div>` : null}
          <div class="actions"><button @click=${() => { this.cancel(); }}>${t("ui.sessionCleanupDialog.cancel", "Cancel")}</button><button class="primary" ?disabled=${state.saving === true} @click=${() => { this.onSaveApiKey?.(); }}>${state.saving === true ? t("ui.settingsGeneralPanel.saving", "Saving…") : t("ui.authDialog.saveApiKey", "Save API key")}</button></div>
        </div>
      `;
      case "oauth": return this.renderOAuth(state);
    }
  }

  private renderOptionList(state: Exclude<AuthDialogState, { step: "apiKey" | "oauth" }>, credentialScope: string): TemplateResult {
    const options = this.optionsFor(state, credentialScope) ?? [];
    const visible = this.filteredOptions(options);
    const empty = state.step === "logout" ? t("ui.authDialog.noSavedCredentialsEnvironmentVariablesAndModelsJson", "No saved credentials. Environment variables and models.json settings will not change.") : t("ui.authDialog.noProvidersAvailable", "No providers available.");
    return html`
      ${this.stepHasSearch(state) && options.length > 0 ? html`
        <input aria-label="${t("ui.main.74e04909526d", "Search providers")}" placeholder="${t("ui.main.74e04909526d", "Search providers")}" .value=${this.query} @input=${(event: Event) => { this.handleSearchInput(event); }}>
      ` : null}
      <div class="options">
        ${options.length === 0 ? html`<div class="empty">${empty}</div>`
        : visible.length === 0 ? html`<div class="empty">${t("ui.main.b3c77c2d4d90", "No matching providers")}</div>`
        : visible.map((option, index) => html`
          <button class=${index === this.selectedIndex ? "selected" : ""} aria-current=${index === this.selectedIndex ? "true" : nothing} ${scrollWhenSelected(index === this.selectedIndex, option.key)} @focus=${() => { this.selectedIndex = index; }} @click=${() => { option.run(); }}>
            <span>${option.title}</span>
            <small>${option.detail}</small>
          </button>
        `)}
      </div>
    `;
  }

  private optionsFor(state: AuthDialogState, credentialScope = state.target.projectName === undefined ? t("ui.authDialog.currentMode", "current mode") : t("ui.authDialog.currentProject", "current project")): AuthDialogOption[] | undefined {
    switch (state.step) {
      case "method": return [
        { key: "oauth", title: t("ui.authDialog.useSubscription", "Use subscription"), detail: t("ui.authDialog.chatgptPlusProClaudeProMaxOrGithub", "ChatGPT Plus/Pro, Claude Pro/Max, or GitHub Copilot"), searchText: t("ui.authDialog.useSubscription", "Use subscription"), run: () => { this.onChooseMethod?.("oauth"); } },
        { key: "api_key", title: t("ui.authDialog.useApiKey", "Use API key"), detail: t("ui.authDialog.credentialDestination", "Save the API key in auth.json for the {scope}", { scope: credentialScope }), searchText: t("ui.authDialog.useApiKey", "Use API key"), run: () => { this.onChooseMethod?.("api_key"); } },
      ];
      case "providers": return state.providers.map((provider) => ({
        key: `${provider.id}:${provider.authType}`,
        title: html`${provider.name}${provider.status.source !== undefined ? html` <em>${statusLabel(provider)}</em>` : null}`,
        detail: `${provider.id} · ${authTypeLabel(provider.authType)}`,
        searchText: provider.name,
        run: () => { this.onSelectProvider?.(provider.id, provider.authType); },
      }));
      case "logout": return state.providers.map((provider) => ({
        key: `${provider.id}:${provider.authType}`,
        title: provider.name,
        detail: `${provider.id} · ${authTypeLabel(provider.authType)}`,
        searchText: provider.name,
        run: () => { this.onLogoutProvider?.(provider.id); },
      }));
      case "apiKey":
      case "oauth": return undefined;
    }
  }

  private stepHasSearch(state: AuthDialogState): boolean {
    return state.step === "providers" || state.step === "logout";
  }

  private handleSearchInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.query = event.target.value;
    this.selectedIndex = 0;
  }

  private filteredOptions(options: AuthDialogOption[]): AuthDialogOption[] {
    const query = this.query.trim().toLowerCase();
    if (query === "") return options;
    return options.filter((option) => `${option.searchText} ${option.detail}`.toLowerCase().includes(query));
  }

  private visibleOptions(state: AuthDialogState): AuthDialogOption[] {
    return this.filteredOptions(this.optionsFor(state) ?? []);
  }

  private renderOAuth(state: Extract<AuthDialogState, { step: "oauth" }>) {
    const flow = state.flow;
    const prompt = flow.prompt;
    const select = flow.select;
    const promptInputType = oauthPromptInputType(prompt?.promptType);
    const showPasteNote = shouldShowRemoteOAuthPasteNote(state, window.location.hostname);
    return html`
      <div class="form">
          ${flow.auth !== undefined ? html`
            <p>${t("ui.authDialog.openThisAuthorizationLink", "Open this authorization link:")}</p>
            <p><a href=${flow.auth.url} target="_blank" rel="noreferrer">${flow.auth.url}</a></p>
            ${flow.auth.deviceCode !== undefined ? html`
              <p class="warning">${t("ui.authDialog.enterCode", "Enter code: ")}<code>${flow.auth.deviceCode.userCode}</code></p>
            ` : flow.auth.instructions !== undefined ? html`<p class="warning">${flow.auth.instructions}</p>` : null}
        ` : html`<p>${t("ui.authDialog.startingLogin", "Starting login…")}</p>`}
        ${showPasteNote ? html`<p class="warning">${t("ui.main.1b884d0f9ef1", "After you approve, the redirect page will probably fail to load — that is expected. Copy the full URL from your browser's address bar and paste it below.")}</p>` : null}
        ${flow.progress.length > 0 ? html`<ul class="progress">${flow.progress.map((line) => html`<li>${line}</li>`)}</ul>` : null}
        ${flow.info?.map((item) => item.links === undefined || item.links.length === 0 ? null : html`
          <div class="info-links" aria-label="${t("ui.authDialog.relatedInformation", "Related information")}">
            ${item.links.map((link) => html`<a href=${link.url} target="_blank" rel="noreferrer" title=${item.message}>${link.label ?? link.url}</a>`)}
          </div>
        `) ?? null}
        ${prompt !== undefined ? html`
          <label>${prompt.message}</label>
          <input type=${promptInputType} autocomplete=${promptInputType === "password" ? "off" : "on"} .value=${state.inputValue ?? ""} placeholder=${prompt.placeholder ?? ""} @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.onOAuthInput?.(event.target.value); }}>
          <div class="actions"><button @click=${() => { this.onOAuthCancel?.(); }}>${t("ui.sessionCleanupDialog.cancel", "Cancel")}</button><button class="primary" ?disabled=${state.responding === true} @click=${() => { this.onOAuthRespond?.(); }}>${t("ui.authDialog.submit", "Submit")}</button></div>
        ` : null}
        ${select !== undefined ? html`
          <p>${select.message}</p>
          <div class="inline-options">${select.options.map((option) => html`
            <button @click=${() => { this.onOAuthRespond?.(option.value); }}>
              <span>${option.label}</span>
              ${option.description === undefined ? null : html`<small>${option.description}</small>`}
            </button>
          `)}</div>
        ` : null}
        ${state.error !== undefined && state.error !== "" ? html`<div class="error-text">${state.error}</div>` : null}
        ${flow.status === "error" || flow.status === "cancelled" ? html`<div class="error-text">${flow.error ?? flowStatusLabel(flow.status)}</div><div class="actions"><button @click=${() => { this.cancel(); }}>${t("ui.common.close", "Close")}</button></div>` : null}
        ${prompt === undefined && select === undefined && flow.status === "running" ? html`<div class="actions"><button @click=${() => { this.onOAuthCancel?.(); }}>${t("ui.sessionCleanupDialog.cancel", "Cancel")}</button></div>` : null}
      </div>
    `;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const state = this.state;
    if (state === undefined || keyboardEventOriginatesFromNativeActivationControl(event)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const options = this.visibleOptions(state);
      if (options.length === 0) return;
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      this.selectedIndex = (this.selectedIndex + delta + options.length) % options.length;
      return;
    }
    if (event.key !== "Enter") return;
    if (state.step === "apiKey") {
      event.preventDefault();
      this.onSaveApiKey?.();
    } else if (state.step === "oauth" && state.flow.prompt !== undefined) {
      event.preventDefault();
      this.onOAuthRespond?.();
    } else {
      const option = this.visibleOptions(state)[this.selectedIndex];
      if (option === undefined) return;
      event.preventDefault();
      option.run();
    }
  }

  private cancel(): void {
    const state = this.state;
    if (state?.step === "oauth") this.onOAuthCancel?.();
    else this.onCancel?.();
  }

  private initialFocus(state: AuthDialogState): string | undefined {
    return state.step === "apiKey"
      || (state.step === "oauth" && state.flow.prompt !== undefined)
      || ((state.step === "providers" || state.step === "logout") && state.providers.length > 0)
      ? "input"
      : undefined;
  }

  static override styles = [commandPickerStyles, css`
    modal-surface { --modal-surface-width: min(720px, calc(100vw - 40px)); --modal-surface-max-height: min(640px, calc(100% - 40px)); }
    .form { display: grid; gap: 12px; padding: 14px; overflow: auto; }
    .form p { margin: 0; color: var(--pi-text-secondary); overflow-wrap: anywhere; }
    .form a { color: var(--pi-accent); overflow-wrap: anywhere; }
    .form code { border: 1px solid var(--pi-border); border-radius: 4px; background: var(--pi-surface); padding: 1px 4px; }
    label { color: var(--pi-muted); }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    .actions button, .inline-options button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; }
    .actions button.primary { border-color: var(--pi-success-border); background: var(--pi-success-surface); color: var(--pi-success); }
    .actions button:disabled { opacity: .6; cursor: wait; }
    .warning { color: var(--pi-warning); }
    .error-text { color: var(--pi-danger); }
    .progress { margin: 0; padding-left: 18px; color: var(--pi-muted); }
    .info-links { display: flex; flex-wrap: wrap; gap: 8px 12px; }
    .inline-options { display: grid; gap: 8px; }
    .inline-options button { display: grid; gap: 2px; text-align: left; }
    .inline-options small { color: var(--pi-muted); }
    em { color: var(--pi-success); font-style: normal; font-size: 12px; }
  `];
}

export function oauthPromptInputType(promptType: NonNullable<OAuthFlowState["prompt"]>["promptType"]): "text" | "password" {
  return promptType === "secret" ? "password" : "text";
}

const loopbackHostnames = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLoopbackHostname(hostname: string): boolean {
  return loopbackHostnames.has(hostname.trim().replace(/^\[|\]$/gu, "").toLowerCase());
}

export function isBrowserRemoteOAuthMachine(machineId: string, hostname: string): boolean {
  return machineId !== LOCAL_MACHINE_ID || !isLoopbackHostname(hostname);
}

export function shouldShowRemoteOAuthPasteNote(state: Extract<AuthDialogState, { step: "oauth" }>, hostname: string): boolean {
  return isBrowserRemoteOAuthMachine(state.target.machineId, hostname)
    && state.flow.status === "running"
    && state.flow.prompt?.promptType === "manual_code";
}

function authTypeLabel(authType: "oauth" | "api_key"): string {
  return authType === "oauth" ? t("ui.authDialog.subscription", "Subscription") : "API key";
}

function oauthInteractionKey(value: unknown): string | undefined {
  if (authDialogStateStep(value) !== "oauth" || typeof value !== "object" || value === null || !("flow" in value)) return undefined;
  const flow = value.flow;
  if (typeof flow !== "object" || flow === null) return undefined;
  const flowId = "flowId" in flow && typeof flow.flowId === "string" ? flow.flowId : "";
  const promptRequestId = "prompt" in flow ? oauthInteractionRequestId(flow.prompt) : undefined;
  if (promptRequestId !== undefined) {
    const responsePhase = "responding" in value && value.responding === true ? "responding" : "ready";
    return `${flowId}:prompt:${promptRequestId}:${responsePhase}`;
  }
  const selectRequestId = "select" in flow ? oauthInteractionRequestId(flow.select) : undefined;
  if (selectRequestId !== undefined) return `${flowId}:select:${selectRequestId}`;
  const status = "status" in flow && typeof flow.status === "string" ? flow.status : "unknown";
  return `${flowId}:waiting:${status}`;
}

function oauthInteractionRequestId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("requestId" in value)) return undefined;
  return typeof value.requestId === "string" ? value.requestId : undefined;
}

/** Step of a previous `state` value read from a PropertyValues map, without type assertions. */
function authDialogStateStep(value: unknown): AuthDialogState["step"] | undefined {
  if (typeof value !== "object" || value === null || !("step" in value)) return undefined;
  switch (value.step) {
    case "method":
    case "providers":
    case "apiKey":
    case "oauth":
    case "logout":
      return value.step;
    default:
      return undefined;
  }
}

function statusLabel(provider: AuthProviderOption): string {
  if (provider.status.source === undefined) return "";
  switch (provider.status.source) {
    case "stored": return t("ui.authDialog.configured", "✓ Configured");
    case "environment": return t("ui.authDialog.environment", "✓ Environment{label}", { label: provider.status.label === undefined ? "" : `: ${provider.status.label}` });
    case "runtime": return t("ui.authDialog.runtime", "✓ Runtime");
    case "fallback": return t("ui.authDialog.customKey", "✓ Custom key");
    case "models_json_key": return "✓ models.json key";
    case "models_json_command": return "✓ models.json command";
    default: return "";
  }
}

function flowStatusLabel(status: string): string {
  if (status === "cancelled") return t("client.shellMessages.cancelled.a37778", "Cancelled");
  if (status === "error") return t("client.sessionNotifications.error.0bc1fb", "Error");
  return status;
}

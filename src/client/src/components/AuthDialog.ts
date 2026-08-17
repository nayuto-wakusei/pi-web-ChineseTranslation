import { LitElement, css, html, nothing, type TemplateResult } from "lit";
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
  private lastFocusedInputKey: string | undefined;
  private lastStep: AuthDialogState["step"] | undefined;

  override render() {
    const state = this.state;
    if (state === undefined) return null;
    const busy = state.step === "apiKey" ? state.saving === true : state.step === "oauth" && state.responding === true;
    return html`
      <modal-surface .onClose=${() => { this.cancel(); }} .onBusyEscape=${state.step === "oauth" ? () => this.onOAuthCancel?.() : undefined} .busy=${busy} .initialFocus=${this.initialFocus(state)} .label=${this.dialogTitle(state)} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
          <header>
            <strong>${this.dialogTitle(state)}</strong>
            <button title="关闭" @click=${() => { this.cancel(); }}>×</button>
          </header>
          ${this.renderBody(state)}
      </modal-surface>
    `;
  }

  protected override updated(): void {
    const step = this.state?.step;
    if (step !== this.lastStep) this.selectedIndex = 0;
    this.lastStep = step;
    const options = this.state === undefined ? undefined : this.optionsFor(this.state);
    if (options !== undefined && this.selectedIndex >= options.length) this.selectedIndex = Math.max(0, options.length - 1);
    this.focusInputIfNeeded();
  }

  private dialogTitle(state: AuthDialogState): string {
    const scope = state.target.projectName === undefined ? "" : ` · ${state.target.projectName}`;
    switch (state.step) {
      case "method": return `配置提供商认证${scope}`;
      case "providers": return `${state.authType === undefined ? "选择提供商认证" : state.authType === "oauth" ? "选择订阅提供商" : "选择 API key 提供商"}${scope}`;
      case "apiKey": return `${state.provider.name} 的 API key${scope}`;
      case "oauth": return `登录 ${state.flow.providerName}${scope}`;
      case "logout": return `移除已保存的提供商认证${scope}`;
    }
  }

  private renderBody(state: AuthDialogState) {
    const credentialScope = state.target.projectName === undefined ? "当前模式" : "当前项目";
    switch (state.step) {
      case "method":
      case "providers":
      case "logout": return this.renderOptionList(state, credentialScope);
      case "apiKey": return html`
        <div class="form">
          <p>输入 <strong>${state.provider.name}</strong> 的 API key。它会保存到${credentialScope}的凭据文件。</p>
          <input type="password" autocomplete="off" placeholder="API key" .value=${state.value} @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.onApiKeyInput?.(event.target.value); }}>
          ${state.error !== undefined && state.error !== "" ? html`<div class="error-text">${state.error}</div>` : null}
          <div class="actions"><button @click=${() => { this.cancel(); }}>取消</button><button class="primary" ?disabled=${state.saving === true} @click=${() => { this.onSaveApiKey?.(); }}>${state.saving === true ? "正在保存…" : "保存 API key"}</button></div>
        </div>
      `;
      case "oauth": return this.renderOAuth(state);
    }
  }

  private renderOptionList(state: Exclude<AuthDialogState, { step: "apiKey" | "oauth" }>, credentialScope: string): TemplateResult {
    const options = this.optionsFor(state, credentialScope) ?? [];
    const empty = state.step === "logout" ? "没有已保存的凭据。环境变量和 models.json 设置不会变化。" : "没有可用提供商。";
    return html`
      <div class="options">
        ${options.length === 0 ? html`<div class="empty">${empty}</div>` : options.map((option, index) => html`
          <button class=${index === this.selectedIndex ? "selected" : ""} aria-current=${index === this.selectedIndex ? "true" : nothing} ${scrollWhenSelected(index === this.selectedIndex, option.key)} @focus=${() => { this.selectedIndex = index; }} @click=${() => { option.run(); }}>
            <span>${option.title}</span>
            <small>${option.detail}</small>
          </button>
        `)}
      </div>
    `;
  }

  private optionsFor(state: AuthDialogState, credentialScope = state.target.projectName === undefined ? "当前模式" : "当前项目"): AuthDialogOption[] | undefined {
    switch (state.step) {
      case "method": return [
        { key: "oauth", title: "使用订阅", detail: "ChatGPT Plus/Pro、Claude Pro/Max 或 GitHub Copilot", run: () => { this.onChooseMethod?.("oauth"); } },
        { key: "api_key", title: "使用 API key", detail: `将 API key 存入${credentialScope}的 auth.json`, run: () => { this.onChooseMethod?.("api_key"); } },
      ];
      case "providers": return state.providers.map((provider) => ({
        key: `${provider.id}:${provider.authType}`,
        title: html`${provider.name}${provider.status.source !== undefined ? html` <em>${statusLabel(provider)}</em>` : null}`,
        detail: `${provider.id} · ${authTypeLabel(provider.authType)}`,
        run: () => { this.onSelectProvider?.(provider.id, provider.authType); },
      }));
      case "logout": return state.providers.map((provider) => ({
        key: `${provider.id}:${provider.authType}`,
        title: provider.name,
        detail: `${provider.id} · ${authTypeLabel(provider.authType)}`,
        run: () => { this.onLogoutProvider?.(provider.id); },
      }));
      case "apiKey":
      case "oauth": return undefined;
    }
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
            <p>打开此授权链接：</p>
            <p><a href=${flow.auth.url} target="_blank" rel="noreferrer">${flow.auth.url}</a></p>
            ${flow.auth.deviceCode !== undefined ? html`
              <p class="warning">输入代码：<code>${flow.auth.deviceCode.userCode}</code></p>
            ` : flow.auth.instructions !== undefined ? html`<p class="warning">${flow.auth.instructions}</p>` : null}
        ` : html`<p>正在启动登录流程…</p>`}
        ${showPasteNote ? html`<p class="warning">授权完成后，重定向页面可能无法打开，这是正常现象。请复制浏览器地址栏中的完整 URL，并粘贴到下方输入框。</p>` : null}
        ${flow.progress.length > 0 ? html`<ul class="progress">${flow.progress.map((line) => html`<li>${line}</li>`)}</ul>` : null}
        ${flow.info?.map((item) => item.links === undefined || item.links.length === 0 ? null : html`
          <div class="info-links" aria-label="相关信息">
            ${item.links.map((link) => html`<a href=${link.url} target="_blank" rel="noreferrer" title=${item.message}>${link.label ?? link.url}</a>`)}
          </div>
        `) ?? null}
        ${prompt !== undefined ? html`
          <label>${prompt.message}</label>
          <input type=${promptInputType} autocomplete=${promptInputType === "password" ? "off" : "on"} .value=${state.inputValue ?? ""} placeholder=${prompt.placeholder ?? ""} @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.onOAuthInput?.(event.target.value); }}>
          <div class="actions"><button @click=${() => { this.onOAuthCancel?.(); }}>取消</button><button class="primary" ?disabled=${state.responding === true} @click=${() => { this.onOAuthRespond?.(); }}>提交</button></div>
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
        ${flow.status === "error" || flow.status === "cancelled" ? html`<div class="error-text">${flow.error ?? flowStatusLabel(flow.status)}</div><div class="actions"><button @click=${() => { this.cancel(); }}>关闭</button></div>` : null}
        ${prompt === undefined && select === undefined && flow.status === "running" ? html`<div class="actions"><button @click=${() => { this.onOAuthCancel?.(); }}>取消</button></div>` : null}
      </div>
    `;
  }

  private focusInputIfNeeded(): void {
    const key = focusKey(this.state);
    if (key === undefined) {
      this.lastFocusedInputKey = undefined;
      return;
    }
    if (key === this.lastFocusedInputKey) return;
    this.lastFocusedInputKey = key;
    this.modalSurface?.focusDialog();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const state = this.state;
    if (state === undefined || keyboardEventOriginatesFromNativeActivationControl(event)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const options = this.optionsFor(state);
      if (options === undefined || options.length === 0) return;
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
      const option = this.optionsFor(state)?.[this.selectedIndex];
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

  private initialFocus(state: AuthDialogState): string {
    return state.step === "apiKey" || (state.step === "oauth" && state.flow.prompt !== undefined) ? "input" : "button";
  }

  static override styles = [commandPickerStyles, css`
    modal-surface { --modal-surface-width: min(720px, calc(100vw - 40px)); --modal-surface-max-height: min(640px, calc(100vh - 40px)); }
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
  return authType === "oauth" ? "订阅" : "API key";
}

function focusKey(state: AuthDialogState | undefined): string | undefined {
  if (state?.step === "apiKey") return `api-key:${state.provider.authType}:${state.provider.id}`;
  if (state?.step === "oauth" && state.flow.prompt !== undefined) return `oauth:${state.flow.flowId}:${state.flow.prompt.requestId}`;
  return undefined;
}

function statusLabel(provider: AuthProviderOption): string {
  if (provider.status.source === undefined) return "";
  switch (provider.status.source) {
    case "stored": return "✓ 已配置";
    case "environment": return `✓ 环境变量${provider.status.label === undefined ? "" : `: ${provider.status.label}`}`;
    case "runtime": return "✓ 运行时";
    case "fallback": return "✓ 自定义 key";
    case "models_json_key": return "✓ models.json key";
    case "models_json_command": return "✓ models.json command";
    default: return "";
  }
}

function flowStatusLabel(status: string): string {
  if (status === "cancelled") return "已取消";
  if (status === "error") return "错误";
  return status;
}


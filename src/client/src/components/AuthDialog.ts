import { LitElement, css, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { AuthDialogState } from "../appState";
import type { AuthProviderOption } from "../api";
import { commandPickerStyles } from "./shared";

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
  @query("input") private input?: HTMLInputElement;
  private lastFocusedInputKey: string | undefined;

  override render() {
    const state = this.state;
    if (state === undefined) return null;
    return html`
      <div class="backdrop" @mousedown=${() => { this.cancel(); }}>
        <section @mousedown=${(event: MouseEvent) => { event.stopPropagation(); }} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
          <header>
            <strong>${this.dialogTitle(state)}</strong>
            <button title="关闭" @click=${() => { this.cancel(); }}>×</button>
          </header>
          ${this.renderBody(state)}
        </section>
      </div>
    `;
  }

  protected override updated(): void {
    this.focusInputIfNeeded();
  }

  private dialogTitle(state: AuthDialogState): string {
    switch (state.step) {
      case "method": return "配置提供商认证";
      case "providers": return state.authType === undefined ? "选择提供商认证" : state.authType === "oauth" ? "选择订阅提供商" : "选择 API key 提供商";
      case "apiKey": return `${state.provider.name} 的 API key`;
      case "oauth": return `登录 ${state.flow.providerName}`;
      case "logout": return "移除已保存的提供商认证";
    }
  }

  private renderBody(state: AuthDialogState) {
    switch (state.step) {
      case "method": return html`
        <div class="options">
          <button @click=${() => { this.onChooseMethod?.("oauth"); }}><span>使用订阅</span><small>ChatGPT Plus/Pro、Claude Pro/Max 或 GitHub Copilot</small></button>
          <button @click=${() => { this.onChooseMethod?.("api_key"); }}><span>使用 API key</span><small>将 API key 存入 pi auth.json</small></button>
        </div>
      `;
      case "providers": return html`<div class="options">${state.providers.length === 0 ? html`<div class="empty">没有可用提供商。</div>` : state.providers.map((provider) => this.renderProviderButton(provider))}</div>`;
      case "apiKey": return html`
        <div class="form">
          <p>输入 <strong>${state.provider.name}</strong> 的 API key。它会由 pi 存入 <code>auth.json</code>。</p>
          <input type="password" autocomplete="off" placeholder="API key" .value=${state.value} @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.onApiKeyInput?.(event.target.value); }}>
          ${state.error !== undefined && state.error !== "" ? html`<div class="error-text">${state.error}</div>` : null}
          <div class="actions"><button @click=${() => { this.cancel(); }}>取消</button><button class="primary" ?disabled=${state.saving === true} @click=${() => { this.onSaveApiKey?.(); }}>${state.saving === true ? "正在保存…" : "保存 API key"}</button></div>
        </div>
      `;
      case "oauth": return this.renderOAuth(state);
      case "logout": return html`<div class="options">${state.providers.length === 0 ? html`<div class="empty">没有已保存的凭据。环境变量和 models.json 设置不会变化。</div>` : state.providers.map((provider) => html`
        <button @click=${() => { this.onLogoutProvider?.(provider.id); }}><span>${provider.name}</span><small>${provider.id} · ${authTypeLabel(provider.authType)}</small></button>
      `)}</div>`;
    }
  }

  private renderProviderButton(provider: AuthProviderOption) {
    return html`
      <button @click=${() => { this.onSelectProvider?.(provider.id, provider.authType); }}>
        <span>${provider.name}${provider.status.source !== undefined ? html` <em>${statusLabel(provider)}</em>` : null}</span>
        <small>${provider.id} · ${authTypeLabel(provider.authType)}</small>
      </button>
    `;
  }

  private renderOAuth(state: Extract<AuthDialogState, { step: "oauth" }>) {
    const flow = state.flow;
    const prompt = flow.prompt;
    const select = flow.select;
    return html`
      <div class="form">
        ${flow.auth !== undefined ? html`
          <p>打开此授权链接：</p>
          <p><a href=${flow.auth.url} target="_blank" rel="noreferrer">${flow.auth.url}</a></p>
          ${flow.auth.instructions !== undefined ? html`<p class="warning">${flow.auth.instructions}</p>` : null}
        ` : html`<p>正在启动登录流程…</p>`}
        ${flow.progress.length > 0 ? html`<ul class="progress">${flow.progress.map((line) => html`<li>${line}</li>`)}</ul>` : null}
        ${prompt !== undefined ? html`
          <label>${prompt.message}</label>
          <input .value=${state.inputValue ?? ""} placeholder=${prompt.placeholder ?? ""} @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.onOAuthInput?.(event.target.value); }}>
          <div class="actions"><button @click=${() => { this.onOAuthCancel?.(); }}>取消</button><button class="primary" ?disabled=${state.responding === true} @click=${() => { this.onOAuthRespond?.(); }}>提交</button></div>
        ` : null}
        ${select !== undefined ? html`
          <p>${select.message}</p>
          <div class="inline-options">${select.options.map((option) => html`<button @click=${() => { this.onOAuthRespond?.(option.value); }}>${option.label}</button>`)}</div>
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
    this.input?.focus();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.cancel();
      return;
    }
    if (event.key !== "Enter") return;
    const state = this.state;
    if (state?.step === "apiKey") {
      event.preventDefault();
      this.onSaveApiKey?.();
    } else if (state?.step === "oauth" && state.flow.prompt !== undefined) {
      event.preventDefault();
      this.onOAuthRespond?.();
    }
  }

  private cancel(): void {
    const state = this.state;
    if (state?.step === "oauth") this.onOAuthCancel?.();
    else this.onCancel?.();
  }

  static override styles = [commandPickerStyles, css`
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
    .inline-options { display: grid; gap: 8px; }
    em { color: var(--pi-success); font-style: normal; font-size: 12px; }
  `];
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


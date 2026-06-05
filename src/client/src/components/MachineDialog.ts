import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

export interface MachineDialogSubmit {
  name: string;
  baseUrl: string;
  token?: string;
}

@customElement("machine-dialog")
export class MachineDialog extends LitElement {
  @property({ attribute: false }) onSubmit?: (input: MachineDialogSubmit) => void | Promise<void>;
  @property({ attribute: false }) onCancel?: () => void;
  @property() error = "";

  @state() private url = "";
  @state() private name = "";
  @state() private token = "";
  @state() private submitting = false;
  @query("input[name='baseUrl']") private urlInput?: HTMLInputElement;
  @query("input[name='name']") private nameInput?: HTMLInputElement;

  private nameEdited = false;
  private previousSuggestedName = "";

  override firstUpdated(): void {
    this.urlInput?.focus();
  }

  private handleUrlInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const url = event.target.value;
    const suggestedName = suggestedMachineNameFromUrl(url);
    if (!this.nameEdited || this.name.trim() === "" || this.name === this.previousSuggestedName) this.name = suggestedName;
    this.previousSuggestedName = suggestedName;
    this.url = url;
  }

  private handleNameInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.nameEdited = true;
    this.name = event.target.value;
  }

  private handleTokenInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.token = event.target.value;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.onCancel?.();
      return;
    }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.name === "baseUrl" && machineBaseUrlValidationMessage(this.url) === undefined) {
      event.preventDefault();
      void this.updateComplete.then(() => {
        this.nameInput?.focus();
        this.nameInput?.select();
      });
    }
  }

  private handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void this.submit();
  }

  private async submit(): Promise<void> {
    const input = this.validInput();
    if (input === undefined || this.submitting) return;
    this.submitting = true;
    try {
      await this.onSubmit?.(input);
    } finally {
      if (this.isConnected) this.submitting = false;
    }
  }

  private validInput(): MachineDialogSubmit | undefined {
    const baseUrl = this.url.trim();
    const name = this.name.trim();
    if (baseUrl === "" || name === "" || machineBaseUrlValidationMessage(baseUrl) !== undefined) return undefined;
    const token = this.token.trim();
    return { name, baseUrl, ...(token === "" ? {} : { token }) };
  }

  override render() {
    const hasUrl = this.url.trim() !== "";
    const urlError = hasUrl ? machineBaseUrlValidationMessage(this.url) : undefined;
    const canSubmit = this.validInput() !== undefined && !this.submitting;
    return html`
      <div class="backdrop" @click=${() => this.onCancel?.()}>
        <section @click=${(event: Event) => { event.stopPropagation(); }}>
          <form @submit=${(event: SubmitEvent) => { this.handleSubmit(event); }} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
            <header>
              <strong>添加机器</strong>
              <button type="button" @click=${() => { this.onCancel?.(); }} aria-label="关闭">×</button>
            </header>
            <div class="body">
              ${this.error === "" ? null : html`<div class="dialog-error" role="alert">${this.error}</div>`}
              <label>
                远程 PI WEB URL
                <input name="baseUrl" type="url" .value=${this.url} @input=${(event: InputEvent) => { this.handleUrlInput(event); }} placeholder="http://dev-box.local:8504" autocomplete="url" inputmode="url" autofocus />
              </label>
              <small class=${urlError === undefined ? "hint" : "field-error"}>${urlError ?? "先输入可访问的基础 URL，包含 http:// 或 https://。"}</small>
              ${hasUrl ? html`
                <label>
                  机器名称
                  <input name="name" type="text" .value=${this.name} @input=${(event: InputEvent) => { this.handleNameInput(event); }} placeholder=${this.previousSuggestedName || "开发机"} autocomplete="off" />
                </label>
                <small class="hint">根据 URL 自动建议。可以改成更友好的侧栏名称。</small>
                <label>
                  Bearer token <span class="optional">可选</span>
                  <input name="token" type="password" .value=${this.token} @input=${(event: InputEvent) => { this.handleTokenInput(event); }} placeholder="如果远程机器不需要 token，可留空" autocomplete="off" />
                </label>
                <small class="hint">只粘贴 token 值；PI WEB 会通过 Authorization: Bearer 请求头发送。</small>
              ` : html`<p class="hint intro">输入 URL 后，PI WEB 会建议机器名称，并允许添加可选的 bearer token。</p>`}
            </div>
            <footer>
              <button type="button" @click=${() => { this.onCancel?.(); }}>取消</button>
              <button class="primary" type="submit" ?disabled=${!canSubmit}>${this.submitting ? "正在添加…" : "添加机器"}</button>
            </footer>
          </form>
        </section>
      </div>
    `;
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 30; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    .backdrop { display: grid; place-items: start center; width: 100%; height: 100%; padding-top: min(12vh, 90px); box-sizing: border-box; background: var(--pi-overlay); }
    section { width: min(560px, calc(100vw - 40px)); max-height: min(640px, calc(100vh - 40px)); border: 1px solid var(--pi-border); border-radius: 12px; background: var(--pi-bg); box-shadow: 0 20px 60px var(--pi-shadow-strong); overflow: hidden; }
    form { display: flex; flex-direction: column; max-height: inherit; min-height: 0; }
    header, footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border); }
    footer { border-top: 1px solid var(--pi-border); border-bottom: 0; justify-content: end; }
    .body { display: grid; gap: 8px; padding: 12px; min-height: 0; overflow: auto; }
    label { display: grid; gap: 6px; color: var(--pi-muted); }
    input { box-sizing: border-box; width: 100%; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); padding: 9px; font: 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    input:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    .hint { color: var(--pi-muted); }
    .intro { margin: 4px 0 0; line-height: 1.4; }
    .optional { color: var(--pi-muted); font-weight: 400; }
    .field-error { color: var(--pi-danger); }
    .dialog-error { border: 1px solid var(--pi-danger); border-radius: 8px; background: color-mix(in srgb, var(--pi-danger) 10%, transparent); color: var(--pi-danger); padding: 9px; line-height: 1.35; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
    header button { border: 0; background: transparent; color: var(--pi-muted); font-size: 22px; padding: 0 8px; }
    .primary { border-color: var(--pi-success-border); background: var(--pi-success-border); }
    button:disabled { opacity: .5; cursor: not-allowed; }
  `;
}

export function suggestedMachineNameFromUrl(value: string): string {
  const raw = value.trim();
  if (raw === "") return "";
  const parsed = parseUrlForSuggestion(raw) ?? parseUrlForSuggestion(`http://${raw.replace(/^\/+/u, "")}`);
  if (parsed !== undefined && parsed.hostname !== "") return parsed.hostname.replace(/^\[(.*)\]$/u, "$1");
  return fallbackSuggestedName(raw);
}

export function machineBaseUrlValidationMessage(value: string): string | undefined {
  const raw = value.trim();
  if (raw === "") return "必须填写远程 PI WEB URL。";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "请输入包含 http:// 或 https:// 的有效 URL。";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "请使用 http:// 或 https:// URL。";
  if (url.username !== "" || url.password !== "") return "机器 URL 中不要包含凭据。";
  if (url.search !== "" || url.hash !== "") return "不要包含查询字符串或片段。";
  return undefined;
}

function parseUrlForSuggestion(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function fallbackSuggestedName(value: string): string {
  const withoutProtocol = value.replace(/^[a-z][a-z\d+.-]*:\/\//iu, "");
  const withoutCredentials = withoutProtocol.slice(withoutProtocol.lastIndexOf("@") + 1);
  const host = withoutCredentials.split(/[/?#]/u)[0] ?? "";
  if (host.startsWith("[") && host.includes("]")) return host.slice(1, host.indexOf("]"));
  return host.replace(/:\d+$/u, "");
}

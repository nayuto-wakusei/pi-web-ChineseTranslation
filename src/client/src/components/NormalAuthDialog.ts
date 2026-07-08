import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

export type NormalAuthDialogMode = "setup" | "login" | "change";

export interface NormalAuthPasswordForm {
  currentPassword?: string;
  password: string;
  confirmPassword?: string;
}

@customElement("normal-auth-dialog")
export class NormalAuthDialog extends LitElement {
  @property() mode: NormalAuthDialogMode = "login";
  @property({ type: Boolean }) loading = false;
  @property() error = "";
  @property({ attribute: false }) onSubmit?: (form: NormalAuthPasswordForm) => void | Promise<void>;
  @property({ attribute: false }) onCancel?: () => void;
  @state() private currentPassword = "";
  @state() private password = "";
  @state() private confirmPassword = "";
  @state() private localError = "";

  override render(): TemplateResult {
    return html`
      <div class="backdrop">
        <section role="dialog" aria-modal="true" aria-label=${this.dialogTitle()} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
          <header>
            <div>
              <span class="eyebrow">普通模式</span>
              <h1>${this.dialogTitle()}</h1>
            </div>
            ${this.mode === "change" ? html`<button class="close-button" title="关闭" aria-label="关闭" @click=${() => this.onCancel?.()}>×</button>` : null}
          </header>
          <form @submit=${(event: Event) => { void this.submit(event); }}>
            ${this.mode === "change" ? html`
              <label>
                <span>当前密码</span>
                <input type="password" .value=${this.currentPassword} autocomplete="current-password" @input=${(event: Event) => { this.currentPassword = inputValue(event); this.localError = ""; }}>
              </label>
            ` : null}
            <label>
              <span>${this.mode === "login" ? "密码" : "新密码"}</span>
              <input type="password" .value=${this.password} autocomplete=${this.mode === "login" ? "current-password" : "new-password"} @input=${(event: Event) => { this.password = inputValue(event); this.localError = ""; }}>
            </label>
            ${this.mode !== "login" ? html`
              <label>
                <span>确认密码</span>
                <input type="password" .value=${this.confirmPassword} autocomplete="new-password" @input=${(event: Event) => { this.confirmPassword = inputValue(event); this.localError = ""; }}>
              </label>
            ` : null}
            ${this.message() === "" ? null : html`<p class="message">${this.message()}</p>`}
            <footer>
              ${this.mode === "change" ? html`<button type="button" class="secondary" ?disabled=${this.loading} @click=${() => this.onCancel?.()}>取消</button>` : null}
              <button class="primary" ?disabled=${this.loading}>${this.loading ? "正在处理..." : this.submitLabel()}</button>
            </footer>
          </form>
        </section>
      </div>
    `;
  }

  private dialogTitle(): string {
    if (this.mode === "setup") return "设置进入密码";
    if (this.mode === "change") return "修改进入密码";
    return "输入进入密码";
  }

  private submitLabel(): string {
    if (this.mode === "setup") return "设置并进入";
    if (this.mode === "change") return "保存密码";
    return "进入";
  }

  private message(): string {
    return this.localError || this.error;
  }

  private async submit(event: Event): Promise<void> {
    event.preventDefault();
    const form = { currentPassword: this.currentPassword, password: this.password, confirmPassword: this.confirmPassword };
    const error = normalAuthPasswordFormError(this.mode, form);
    if (error !== undefined) {
      this.localError = error;
      return;
    }
    this.localError = "";
    await this.onSubmit?.(form);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || this.mode !== "change") return;
    event.preventDefault();
    event.stopPropagation();
    this.onCancel?.();
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 40; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    .backdrop { box-sizing: border-box; width: 100%; height: 100dvh; display: grid; place-items: center; padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); background: var(--pi-bg); }
    section { width: min(420px, 100%); border: 1px solid var(--pi-border); border-radius: 12px; background: var(--pi-surface); box-shadow: 0 20px 60px var(--pi-shadow-strong); overflow: hidden; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid var(--pi-border); }
    .eyebrow { display: block; color: var(--pi-muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 20px; line-height: 1.2; }
    form { display: grid; gap: 14px; padding: 16px; }
    label { display: grid; gap: 6px; }
    label span { color: var(--pi-muted); font-size: 12px; font-weight: 700; }
    input { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); padding: 10px; outline: none; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
    input:focus { border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent-border); }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 8px 10px; font: inherit; cursor: pointer; }
    button:disabled { opacity: .6; cursor: default; }
    .primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-accent-contrast); }
    .close-button { width: 34px; height: 34px; display: grid; place-items: center; border: 0; background: transparent; color: var(--pi-muted); padding: 0; font-size: 24px; }
    .message { margin: 0; border: 1px solid var(--pi-danger-border); border-radius: 8px; background: var(--pi-danger-surface); color: var(--pi-danger); padding: 10px; }
    footer { display: flex; justify-content: flex-end; gap: 8px; }
  `;
}

export function normalAuthPasswordFormError(mode: NormalAuthDialogMode, form: NormalAuthPasswordForm): string | undefined {
  if (mode === "change" && (form.currentPassword ?? "") === "") return "请输入当前密码。";
  if (form.password === "") return "请输入密码。";
  if (mode !== "login" && form.password !== (form.confirmPassword ?? "")) return "两次输入的密码不一致。";
  return undefined;
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

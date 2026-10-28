import { LocalizationController } from "../localization/browser";
import { machineMessages as messages } from "../machineMessages";
import { stylesheetIntegrationCapability } from "../plugins/styles";
import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Machine } from "../api";
import "./ModalSurface";
import { uiDialogStyles, uiFormStyles } from "./ui/dialogStyles";

export interface MachineDialogSubmit {
  name: string;
  baseUrl: string;
  token?: string;
}

@customElement("machine-dialog")
export class MachineDialog extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
    new LocalizationController(this);
  }

  @property({ attribute: false }) onSubmit?: (input: MachineDialogSubmit) => void | Promise<void>;
  @property({ attribute: false }) onCancel?: () => void;
  @property() error = "";
  @property({ attribute: false }) machine?: Machine;

  @state() private url = "";
  @state() private name = "";
  @state() private token = "";
  @state() private submitting = false;
  @query("input[name='name']") private nameInput?: HTMLInputElement;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("machine")) {
      this.name = this.machine?.nameOverride ?? "";
      this.url = this.machine?.baseUrl ?? "";
    }
  }

  private handleUrlInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.url = event.target.value;
  }

  private handleNameInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.name = event.target.value;
  }

  private handleTokenInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.token = event.target.value;
  }

  private handleKeyDown(event: KeyboardEvent): void {
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
    if (baseUrl === "" || machineBaseUrlValidationMessage(baseUrl) !== undefined) return undefined;
    const token = this.token.trim();
    return { name, baseUrl, ...(token === "" ? {} : { token }) };
  }

  override render() {
    const editing = this.machine !== undefined;
    const title = editing ? messages.t("editTitle") : messages.t("addTitle");
    const hasUrl = this.url.trim() !== "";
    const urlError = hasUrl ? machineBaseUrlValidationMessage(this.url) : undefined;
    const canSubmit = this.validInput() !== undefined && !this.submitting;
    return html`
      <modal-surface
        .onClose=${() => this.onCancel?.()}
        .busy=${this.submitting}
        .initialFocus=${editing ? "input[name='name']" : "input[name='baseUrl']"}
        .label=${title}
        @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}
      >
        <form class="ui-form" aria-describedby=${this.error === "" ? "" : "machine-error"} @submit=${(event: SubmitEvent) => { this.handleSubmit(event); }}>
          <header class="ui-dialog-header">
            <strong class="ui-dialog-title">${title}</strong>
            <button class="ui-button ui-button--icon" type="button" @click=${() => { this.onCancel?.(); }} aria-label=${editing ? messages.t("closeEdit") : messages.t("closeAdd")}>×</button>
          </header>
          <div class="body ui-dialog-body ui-form-body">
            ${this.error === "" ? null : html`<div id="machine-error" class="dialog-error ui-form-error" role="alert">${this.error}</div>`}
            ${editing ? html`<p class="hint"><bdi dir="ltr">${this.machine?.baseUrl}</bdi></p>` : html`<label class="ui-form-field">
              ${messages.t("urlLabel")}
              <input class="ui-input" name="baseUrl" type="url" dir="ltr" aria-describedby="machine-url-help" aria-invalid=${urlError !== undefined ? "true" : "false"} .value=${this.url} @input=${(event: InputEvent) => { this.handleUrlInput(event); }} placeholder="http://dev-box.local:8504" autocomplete="url" inputmode="url" />
            </label>
            <small id="machine-url-help" aria-live="polite" class=${urlError === undefined ? "hint" : "field-error"}>${urlError ?? messages.t("urlHelp")}</small>`}
            ${hasUrl ? html`
              <label class="ui-form-field">
                <span>${messages.t("nameLabel")}</span>
                <input class="ui-input" name="name" type="text" maxlength="120" aria-describedby="machine-name-help" .value=${this.name} @input=${(event: InputEvent) => { this.handleNameInput(event); }} autocomplete="off" />
              </label>
              <small id="machine-name-help" class="hint">${messages.t("nameHelp")}</small>
              ${editing ? null : html`<label class="ui-form-field">
                <span>${messages.t("tokenLabel")}</span>
                <input class="ui-input" name="token" type="password" dir="ltr" aria-describedby="machine-token-help" .value=${this.token} @input=${(event: InputEvent) => { this.handleTokenInput(event); }} placeholder=${messages.t("tokenPlaceholder")} autocomplete="off" />
              </label>
              <small id="machine-token-help" class="hint">${messages.t("tokenHelp")}</small>`}
            ` : html`<p class="hint intro">${messages.t("intro")}</p>`}
          </div>
          <footer class="ui-dialog-footer">
            <button class="ui-button" type="button" @click=${() => { this.onCancel?.(); }}>${messages.t("cancel")}</button>
            <button class="ui-button ui-button--primary" type="submit" ?disabled=${!canSubmit}>${this.submitting ? (editing ? messages.t("saving") : messages.t("adding")) : (editing ? messages.t("save") : messages.t("addTitle"))}</button>
          </footer>
        </form>
      </modal-surface>
    `;
  }

  static override styles = [uiDialogStyles, uiFormStyles, css`
    @layer pi-web-base {
    :host { --ui-dialog-width: 560px; --ui-input-font-family: var(--pi-control-monospace-font-family, var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)); }
    .hint { color: var(--pi-muted); }
    .intro { margin: 4px 0 0; line-height: 1.4; }
    .field-error { color: var(--pi-danger); }

    }
  `];
}

export function machineBaseUrlValidationMessage(value: string): string | undefined {
  const raw = value.trim();
  if (raw === "") return messages.t("urlRequired");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return messages.t("urlInvalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return messages.t("urlProtocol");
  if (url.username !== "" || url.password !== "") return messages.t("urlCredentials");
  if (url.search !== "" || url.hash !== "") return messages.t("urlQuery");
  return undefined;
}

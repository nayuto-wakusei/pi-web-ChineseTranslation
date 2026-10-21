import { t } from "../i18n";
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { api, trustApi, type FileSuggestion, type WorkspaceTrustResponse } from "../api";
import type { ProjectTrustChoice } from "../controllers/projectController";
import { css } from "lit";
import "./ModalSurface";

interface ProjectTrustState extends WorkspaceTrustResponse {
  loading: boolean;
  error?: string;
}

@customElement("project-dialog")
export class ProjectDialog extends LitElement {
  @property({ attribute: false }) onSubmit?: (path: string, create: boolean, trust: ProjectTrustChoice | undefined) => void;
  @property({ attribute: false }) onCancel?: () => void;
  @property() machineId = "local";
  @property({ type: Boolean }) managementMode = false;
  @state() private path = "";
  @state() private createMissing = true;
  @state() private suggestions: FileSuggestion[] = [];
  @state() private selected = 0;
  @state() private loading = false;
  @state() private trust: ProjectTrustState | undefined;
  @state() private trustTouched = false;
  @query("input") private pathInput?: HTMLInputElement;

  private requestId = 0;
  private trustRequestId = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadSuggestions();
  }

  override disconnectedCallback(): void {
    this.requestId++;
    this.trustRequestId++;
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("machineId") || changed.has("managementMode")) {
      this.trustTouched = false;
      void this.loadSuggestions();
      void this.loadTrust();
    }
  }

  private async loadSuggestions() {
    const requestId = ++this.requestId;
    this.loading = true;
    try {
      const suggestions = await api.projectDirectories(this.path, this.machineId);
      if (requestId !== this.requestId) return;
      this.suggestions = suggestions;
      this.selected = Math.min(this.selected, Math.max(0, suggestions.length - 1));
    } catch {
      if (requestId === this.requestId) this.suggestions = [];
    } finally {
      if (requestId === this.requestId) this.loading = false;
    }
  }

  private setPath(value: string) {
    this.path = value;
    this.selected = 0;
    this.trustTouched = false;
    void this.loadSuggestions();
    void this.loadTrust();
  }

  private pick(suggestion: FileSuggestion) {
    this.setPath(suggestion.path);
  }

  private submit() {
    if (this.path.trim() === "") return;
    this.onSubmit?.(this.path, this.createMissing, this.trust === undefined ? undefined : { trusted: this.trust.trusted, changed: this.trustTouched });
  }

  private onPathInput(event: InputEvent) {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.setPath(event.target.value);
  }

  private onCreateMissingChange(event: InputEvent) {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.createMissing = event.target.checked;
  }

  /**
   * Server-resolved existing trust for the entered path (never the raw path
   * trusted verbatim). Dropped when a newer path input or an explicit user
   * toggle supersedes it, so a stale read can not clobber the user's choice.
   */
  private async loadTrust() {
    const requestId = ++this.trustRequestId;
    const trimmed = this.path.trim();
    if (trimmed === "" || this.managementMode) {
      if (requestId === this.trustRequestId) this.trust = undefined;
      return;
    }
    this.trust = { ...(this.trust ?? { path: trimmed, decision: null, trusted: false }), path: trimmed, loading: true };
    try {
      const result = await trustApi.projectTrust(trimmed, this.machineId);
      if (requestId !== this.trustRequestId || this.trustTouched) return;
      this.trust = { path: result.path, decision: result.decision, trusted: result.trusted, loading: false };
    } catch (error) {
      if (requestId !== this.trustRequestId || this.trustTouched) return;
      this.trust = { path: trimmed, decision: null, trusted: false, loading: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private onTrustChange(checked: boolean) {
    this.trustTouched = true;
    if (this.trust !== undefined) this.trust = { ...this.trust, trusted: checked, loading: false };
  }

  private renderTrustChoice() {
    if (this.managementMode) return null;
    const unavailable = this.trust === undefined || this.trust.loading || this.trust.error !== undefined;
    return html`
      <label class="check">
        <input type="checkbox" .checked=${this.trust?.trusted ?? false} ?disabled=${unavailable} @change=${(event: InputEvent) => { if (event.target instanceof HTMLInputElement) this.onTrustChange(event.target.checked); }} />
        <span>${t("ui.main.bb60ec05a965", "Trust this project")}</span>
      </label>
      <small class="trust-hint">
        ${t("ui.main.18fc18a3fab2", "Trusting lets pi load this project's .pi settings, extensions, skills, and packages.")}
        <a href="https://pi.dev/docs/latest/security" target="_blank" rel="noreferrer">${t("ui.main.4a0d54a22e9b", "Learn about project trust")}</a>
      </small>
      ${this.trust?.error === undefined ? null : html`<small class="trust-error">${t("ui.main.72d4284601a6", "Trust state unavailable:")} ${this.trust.error}</small>`}
    `;
  }

  private onKeyDown(event: KeyboardEvent) {
    if (event.target !== this.pathInput) return;
    if (event.key === "Enter") {
      event.preventDefault();
      this.submit();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selected = Math.min(this.selected + 1, Math.max(0, this.suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selected = Math.max(0, this.selected - 1);
    } else if (event.key === "Tab") {
      const suggestion = this.suggestions[this.selected];
      if (suggestion === undefined) return;
      event.preventDefault();
      this.pick(suggestion);
    }
  }

  override render() {
    return html`
      <modal-surface .onClose=${() => this.onCancel?.()} .initialFocus=${"input"} .label=${t("client.actions.add.project.8964f5", "Add project")} @keydown=${(event: KeyboardEvent) => { this.onKeyDown(event); }}>
          <header>
            <strong>${t("client.actions.add.project.8964f5", "Add project")}</strong>
            <button @click=${() => { this.onCancel?.(); }} aria-label="${t("ui.common.close", "Close")}">×</button>
          </header>
          <div class="body">
            <label>
              ${t("ui.projectDialog.projectFolder", "Project folder")}
              <input .value=${this.path} @input=${(event: InputEvent) => { this.onPathInput(event); }} placeholder="${t("ui.projectDialog.pathToProjectOrCodeProject", "/path/to/project or ~/code/project")}" />
            </label>
            <div class="suggestions">
              ${this.loading ? html`<div class="hint">${t("ui.projectDialog.loadingFolders", "Loading folders…")}</div>` : null}
              ${this.suggestions.map((suggestion, index) => html`
                <button class=${index === this.selected ? "selected" : ""} @click=${() => { this.pick(suggestion); }}>
                  ${suggestion.path}
                </button>
              `)}
              ${!this.loading && this.suggestions.length === 0 ? html`<div class="hint">${t("ui.projectDialog.noMatchingFoldersEnterANewPathTo", "No matching folders. Enter a new path to create one.")}</div>` : null}
            </div>
            <label class="check">
              <input type="checkbox" .checked=${this.createMissing} @change=${(event: InputEvent) => { this.onCreateMissingChange(event); }} />
              ${t("ui.projectDialog.createFolderIfItDoesNotExist", "Create folder if it does not exist")}
            </label>
            ${this.renderTrustChoice()}
          </div>
          <footer>
            <button @click=${() => { this.onCancel?.(); }}>${t("ui.sessionCleanupDialog.cancel", "Cancel")}</button>
            <button class="primary" ?disabled=${this.path.trim() === ""} @click=${() => { this.submit(); }}>${t("client.actions.add.project.8964f5", "Add project")}</button>
          </footer>
      </modal-surface>
    `;
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 30; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    modal-surface { --modal-surface-place-items: start center; --modal-surface-backdrop-padding: min(12dvh, 90px) 0 max(20px, env(safe-area-inset-bottom)); --modal-surface-width: min(720px, calc(100vw - 40px)); --modal-surface-max-height: min(700px, 100%); }
    header, footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border); }
    footer { border-top: 1px solid var(--pi-border); border-bottom: 0; justify-content: end; }
    .body { display: grid; gap: 12px; padding: 12px; min-height: 0; overflow: auto; }
    label { display: grid; gap: 6px; color: var(--pi-muted); }
    input[type="text"], input:not([type]) { box-sizing: border-box; width: 100%; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); padding: 9px; font: var(--pi-control-font-size, 16px) var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    .check { display: flex; grid-template-columns: auto 1fr; align-items: center; color: var(--pi-text); }
    .suggestions { min-height: 90px; max-height: 320px; overflow: auto; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); }
    .suggestions button { display: block; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; border-bottom: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text); padding: 8px 10px; text-align: left; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .suggestions button.selected, .suggestions button:hover { background: var(--pi-selection-bg); }
    .hint { padding: 12px; color: var(--pi-muted); }
    .trust-error { color: var(--pi-danger, #c0392b); }
    .trust-hint { color: var(--pi-muted); line-height: 1.3; }
    .trust-hint a { color: var(--pi-accent); }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
    header button { border: 0; background: transparent; color: var(--pi-muted); font-size: 22px; padding: 0 8px; }
    .primary { border-color: var(--pi-success-border); background: var(--pi-success-border); }
    button:disabled { opacity: .5; cursor: not-allowed; }
  `;
}

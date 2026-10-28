import { LocalizationController, localization } from "../localization/browser";
import { sessionCleanupMessages as messages } from "../sessionCleanupMessages";
import { stylesheetIntegrationCapability } from "../plugins/styles";
import { t } from "../i18n.js";
import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionCleanupExecuteResponse, SessionCleanupPreviewResponse, SessionCleanupProjectSummary, SessionCleanupRequest } from "../api";
import { canRunSessionCleanup, DEFAULT_SESSION_CLEANUP_DRAFT, selectedSessionCleanupProjectCwds, sessionCleanupPreviewForSelectedProjects, sessionCleanupPreviewHasTargets, sessionCleanupRequestKey, validateSessionCleanupDraft, type SessionCleanupDraft } from "../sessionCleanupUi";
import "./ModalSurface";

@customElement("session-cleanup-dialog")
export class SessionCleanupDialog extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
    new LocalizationController(this);
  }

  @property({ type: Boolean }) canCleanup = true;
  @property({ type: String }) unavailableMessage = t("ui.sessionCleanupDialog.updateAndRestartPiWebOnThisMachine", "Update and restart Pi-Web on this machine before cleaning up sessions.");
  @property({ attribute: false }) preview?: SessionCleanupPreviewResponse;
  @property({ attribute: false }) previewRequest?: SessionCleanupRequest;
  @property({ attribute: false }) result?: SessionCleanupExecuteResponse;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) running = false;
  @property({ type: String }) error = "";
  @property({ attribute: false }) errorMessage?: () => string;
  @property({ attribute: false }) onPreview?: (request: SessionCleanupRequest) => void | Promise<void>;
  @property({ attribute: false }) onRun?: (request: SessionCleanupRequest) => void | Promise<void>;
  @property({ attribute: false }) onClose?: () => void;

  @state() private draft: SessionCleanupDraft = { ...DEFAULT_SESSION_CLEANUP_DRAFT };
  @state() private formError: (() => string) | undefined;
  @state() private selectedProjectCwds: string[] | undefined;

  override willUpdate(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("preview")) this.selectedProjectCwds = this.preview?.projects.map((project) => project.cwd);
  }

  override render(): TemplateResult {
    const validation = validateSessionCleanupDraft(this.draft);
    const selectedPreview = this.selectedPreview();
    const runEnabled = this.canCleanup && canRunSessionCleanup({ draft: this.draft, preview: selectedPreview, previewRequest: this.previewRequest, loading: this.loading, running: this.running });
    const runTitle = runEnabled ? messages.t("run") : selectedPreview !== undefined && !sessionCleanupPreviewHasTargets(selectedPreview) ? messages.t("selectRequiredTitle") : messages.t("previewRequiredTitle");
    return html`
      <modal-surface .onClose=${() => { this.onClose?.(); }} .busy=${this.running} .label=${messages.t("title")}>
        <header>
          <div>
            <span class="eyebrow">${messages.t("eyebrow")}</span>
            <h1>${messages.t("title")}</h1>
          </div>
          <button class="close-button" title=${messages.t("closeCleanup")} aria-label=${messages.t("closeCleanup")} @click=${() => { this.onClose?.(); }}>×</button>
        </header>
        <div class="body">
          <p class="intro">${messages.t("intro")}</p>
          ${this.canCleanup ? this.renderForm(validation.ok ? "" : messages.t(validation.code)) : this.renderUnavailable()}
          ${this.renderMessage()}
          ${this.preview === undefined ? null : this.renderPreview(this.preview)}
        </div>
        <div class="feedback" role="status" aria-atomic="true">
          ${this.result === undefined ? null : this.renderResult(this.result)}
        </div>
        <footer>
          <button @click=${() => { this.onClose?.(); }}>${messages.t(this.result === undefined ? "cancel" : "close")}</button>
          <button ?disabled=${!this.canCleanup || this.loading || this.running} @click=${() => { this.previewCleanup(); }}>${messages.t(this.loading ? "previewing" : "preview")}</button>
          <button class="danger" ?disabled=${!runEnabled} title=${runTitle} @click=${() => { this.runCleanup(); }}>${messages.t(this.running ? "running" : "run")}</button>
        </footer>
      </modal-surface>
    `;
  }

  private renderForm(validationError: string): TemplateResult {
    const disabled = this.loading || this.running;
    const validation = validateSessionCleanupDraft(this.draft);
    const previewOutOfDate = this.preview !== undefined && validation.ok && sessionCleanupRequestKey(validation.request) !== sessionCleanupRequestKey(this.previewRequest) && sessionCleanupPreviewHasTargets(this.preview);
    return html`
      <fieldset ?disabled=${disabled}>
        <div class="toggle-row">
          <input type="checkbox" aria-label=${messages.t("archiveEnabled")} .checked=${this.draft.archiveIdleEnabled} @change=${(event: Event) => { this.updateDraft({ archiveIdleEnabled: checkedValue(event) }); }}>
          <label for="archive-days">${messages.t("archiveRule")}</label>
          <input id="archive-days" class="days" aria-label=${messages.t("archiveThreshold")} type="number" min="0" step="1" inputmode="numeric" .value=${this.draft.archiveIdleDays} ?disabled=${disabled || !this.draft.archiveIdleEnabled} @input=${(event: Event) => { this.updateDraft({ archiveIdleDays: inputValue(event) }); }}>
        </div>
        <div class="toggle-row delete-row">
          <input type="checkbox" aria-label=${messages.t("deleteEnabled")} .checked=${this.draft.deleteArchivedEnabled} @change=${(event: Event) => { this.updateDraft({ deleteArchivedEnabled: checkedValue(event) }); }}>
          <label for="delete-days">${messages.t("deleteRule")}</label>
          <input id="delete-days" class="days" aria-label=${messages.t("deleteThreshold")} type="number" min="0" step="1" inputmode="numeric" .value=${this.draft.deleteArchivedDays} ?disabled=${disabled || !this.draft.deleteArchivedEnabled} @input=${(event: Event) => { this.updateDraft({ deleteArchivedDays: inputValue(event) }); }}>
        </div>
      </fieldset>
      <p class="warning">${messages.rich("warning", { strong: (chunks) => html`<strong>${chunks}</strong>` })}</p>
      ${validationError === "" ? null : html`<div class="dialog-error" role="alert">${validationError}</div>`}
      ${previewOutOfDate ? html`<div class="hint" role="status">${messages.t("stale")}</div>` : null}
    `;
  }

  private renderUnavailable(): TemplateResult {
    return html`<div class="unavailable" role="status">${this.unavailableMessage}</div>`;
  }

  private renderMessage(): TemplateResult | null {
    const message = this.formError?.() ?? this.errorMessage?.() ?? this.error;
    return message === "" ? null : html`<div class="dialog-error" role="alert">${message}</div>`;
  }

  private renderPreview(preview: SessionCleanupPreviewResponse): TemplateResult {
    const selectedCwds = this.selectedProjectCwdsForPreview();
    const selected = new Set(selectedCwds);
    const selectedPreview = sessionCleanupPreviewForSelectedProjects(preview, selectedCwds);
    return html`
      <section class="preview" aria-label=${messages.t("previewLabel")}>
        <h2>${messages.t("preview")}</h2>
        ${preview.projects.length === 0 ? html`<p class="empty">${messages.t("empty")}</p>` : html`
          ${this.renderSelectionControls(preview, selectedCwds)}
          <div class="table-scroll" tabindex="0" aria-label=${messages.t("tableLabel")}>
            <table>
              <thead>
                <tr><th>${messages.t("cleanupColumn")}</th><th>${messages.t("pathColumn")}</th><th>${messages.t("archiveColumn")}</th><th>${messages.t("deleteColumn")}</th></tr>
              </thead>
              <tbody>
                ${preview.projects.map((project) => this.renderProjectRow(project, selected.has(project.cwd)))}
              </tbody>
              <tfoot>
                <tr><th colspan="2">${messages.t("totals")}</th><td>${localization.number(selectedPreview.totals.archiveCount)}</td><td>${localization.number(selectedPreview.totals.deleteCount)}</td></tr>
              </tfoot>
            </table>
          </div>
        `}
        ${preview.skippedBusySessionIds === undefined || preview.skippedBusySessionIds.length === 0 ? null : html`<p class="hint">${messages.t("skipped", { count: preview.skippedBusySessionIds.length })}</p>`}
      </section>
    `;
  }

  private renderSelectionControls(preview: SessionCleanupPreviewResponse, selectedCwds: readonly string[]): TemplateResult {
    const disabled = this.loading || this.running;
    return html`
      <div class="selection-controls" role="group" aria-label=${messages.t("selectionLabel")}>
        <span>${messages.t("selection", { selected: selectedCwds.length, total: preview.projects.length })}</span>
        <button ?disabled=${disabled || selectedCwds.length === preview.projects.length} @click=${() => { this.selectAllProjects(); }}>${messages.t("selectAll")}</button>
        <button ?disabled=${disabled || selectedCwds.length === 0} @click=${() => { this.deselectAllProjects(); }}>${messages.t("deselectAll")}</button>
      </div>
      ${selectedCwds.length === 0 ? html`<p class="hint" role="status">${messages.t("selectRequired")}</p>` : null}
    `;
  }

  private renderProjectRow(project: SessionCleanupProjectSummary, selected: boolean): TemplateResult {
    return html`
      <tr class=${selected ? "" : "unselected"}>
        <td class="select-cell"><input type="checkbox" aria-label=${messages.t("selectProject", { path: project.cwd })} .checked=${selected} ?disabled=${this.running} @change=${(event: Event) => { this.setProjectSelected(project.cwd, checkedValue(event)); }}></td>
        <th title=${project.cwd} dir="auto">${project.cwd}</th>
        <td>${localization.number(project.archiveCount)}</td>
        <td>${localization.number(project.deleteCount)}</td>
      </tr>
    `;
  }

  private renderResult(result: SessionCleanupExecuteResponse): TemplateResult {
    return html`
      <section class="result" aria-label=${messages.t("resultLabel")}>
        <h2>${messages.t("complete")}</h2>
        <p>${messages.t("result", { archived: result.archivedSessionIds.length, deleted: result.deletedSessionIds.length })}</p>
      </section>
    `;
  }

  private updateDraft(patch: Partial<SessionCleanupDraft>): void {
    this.draft = { ...this.draft, ...patch };
    this.formError = undefined;
  }

  private selectedPreview(): SessionCleanupPreviewResponse | undefined {
    return this.preview === undefined ? undefined : sessionCleanupPreviewForSelectedProjects(this.preview, this.selectedProjectCwdsForPreview());
  }

  private selectedProjectCwdsForPreview(): string[] {
    return this.preview === undefined ? [] : selectedSessionCleanupProjectCwds(this.preview, this.selectedProjectCwds);
  }

  private selectAllProjects(): void {
    this.selectedProjectCwds = this.preview?.projects.map((project) => project.cwd) ?? [];
    this.formError = undefined;
  }

  private deselectAllProjects(): void {
    this.selectedProjectCwds = [];
    this.formError = undefined;
  }

  private setProjectSelected(cwd: string, selected: boolean): void {
    const preview = this.preview;
    if (preview === undefined) return;
    const selectedCwds = new Set(this.selectedProjectCwdsForPreview());
    if (selected) selectedCwds.add(cwd);
    else selectedCwds.delete(cwd);
    this.selectedProjectCwds = preview.projects.map((project) => project.cwd).filter((projectCwd) => selectedCwds.has(projectCwd));
    this.formError = undefined;
  }

  private previewCleanup(): void {
    const validation = validateSessionCleanupDraft(this.draft);
    if (!validation.ok) {
      this.formError = () => messages.t(validation.code);
      return;
    }
    this.formError = undefined;
    void this.onPreview?.(validation.request);
  }

  private runCleanup(): void {
    const validation = validateSessionCleanupDraft(this.draft);
    if (!validation.ok) {
      this.formError = () => messages.t(validation.code);
      return;
    }
    const selectedPreview = this.selectedPreview();
    const selectedProjectCwds = this.selectedProjectCwdsForPreview();
    if (!this.canCleanup || !canRunSessionCleanup({ draft: this.draft, preview: selectedPreview, previewRequest: this.previewRequest })) {
      const key = selectedPreview !== undefined && !sessionCleanupPreviewHasTargets(selectedPreview) ? "selectRequired" : "previewRequired";
      this.formError = () => messages.t(key);
      return;
    }
    if (selectedPreview === undefined || !confirm(messages.t("confirm", { archive: selectedPreview.totals.archiveCount, delete: selectedPreview.totals.deleteCount }))) return;
    this.formError = undefined;
    void this.onRun?.({ ...validation.request, projectCwds: selectedProjectCwds });
  }

  static override styles = css`
    @layer pi-web-base {
    :host { position: fixed; inset: 0; z-index: 30; color: var(--pi-text); font: 14px var(--pi-font, system-ui, sans-serif); }
    modal-surface { --modal-surface-backdrop-padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); --modal-surface-width: min(760px, 100%); --modal-surface-max-height: min(760px, 100%); --modal-surface-radius: 14px; }
    header, footer { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--pi-border); }
    footer { border-top: 1px solid var(--pi-border); border-bottom: 0; justify-content: end; }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; display: grid; gap: 14px; padding: 16px; }
    .eyebrow { display: block; color: var(--pi-muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 20px; line-height: 1.2; }
    h2 { font-size: 15px; }
    .intro, .hint, .empty { color: var(--pi-muted); }
    fieldset { margin: 0; padding: 0; border: 0; display: grid; gap: 10px; }
    .toggle-row { display: grid; grid-template-columns: auto minmax(0, 1fr) 88px; align-items: center; gap: 8px; color: var(--pi-text); }
    input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--pi-accent); }
    input.days { box-sizing: border-box; width: 88px; min-width: 0; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); padding: 8px 9px; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, var(--pi-font, system-ui, sans-serif)); }
    input.days:disabled { opacity: .55; }
    .warning, .unavailable, .dialog-error, .result { border: 1px solid var(--pi-border); border-radius: 10px; padding: 10px 12px; }
    .warning { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); color: var(--pi-text); }
    .unavailable { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); color: var(--pi-warning); }
    .dialog-error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-bg)); color: var(--pi-danger); }
    .feedback { flex-shrink: 0; }
    .result { margin: 12px 16px; border-color: var(--pi-success-border); background: var(--pi-success-bg); }
    .preview { display: grid; gap: 10px; min-width: 0; }
    .selection-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .selection-controls span { color: var(--pi-muted); }
    .selection-controls button { padding: 5px 7px; font-size: 12px; }
    .table-scroll { max-width: 100%; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; -webkit-overflow-scrolling: touch; border: 1px solid var(--pi-border); border-radius: 10px; }
    table { width: 100%; min-width: 620px; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--pi-border-muted); padding: 8px 10px; text-align: end; }
    thead th:first-child, td.select-cell { width: 72px; text-align: center; }
    th:nth-child(2), td:nth-child(2) { text-align: start; }
    tbody tr.unselected { opacity: .58; }
    tbody th { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-weight: 500; }
    tfoot th, tfoot td { border-bottom: 0; font-weight: 700; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; font: inherit; cursor: pointer; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    button.danger { color: var(--pi-danger); }
    button.danger:not(:disabled):hover { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
    .close-button { width: 34px; height: 34px; display: grid; place-items: center; border: 0; background: transparent; color: var(--pi-muted); padding: 0; font-size: 24px; }
    .close-button:hover, .close-button:focus { color: var(--pi-text); background: var(--pi-surface-hover); }

    @media (max-width: 680px) {
      modal-surface { --modal-surface-place-items: stretch; --modal-surface-backdrop-padding: 0; --modal-surface-width: 100%; --modal-surface-height: 100dvh; --modal-surface-max-height: none; --modal-surface-border: 0; --modal-surface-radius: 0; }
      .toggle-row { grid-template-columns: auto minmax(0, 1fr); }
      .toggle-row input.days { grid-column: 2; }
      table { min-width: 560px; }
      thead th:first-child, td.select-cell { width: 58px; }
    }

    }
  `;
}

function checkedValue(event: Event): boolean {
  return event.target instanceof HTMLInputElement ? event.target.checked : false;
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

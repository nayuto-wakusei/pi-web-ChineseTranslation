import type { StylesheetIntegrationCapabilityV1, FileContentResponse, FilePreviewingCapability, FilePreviewerOption, WorkspaceFilesContextValue } from "@chainingintention/pi-web-cn/plugin-api";
import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { FilesLocalizationController, formatFileSize, type FilesContent } from "./filesLocalization";
import { DEFAULT_WORKSPACE_FILE_VIEW_MODE, workspaceFileViewModeStore, type WorkspaceFileViewMode, type WorkspaceFileViewModeStore } from "./workspaceFileViewMode";
import type { FilesViewerLoader } from "./viewerLoader";

export const DEFAULT_MAX_INLINE_PREVIEW_BYTES = 1024 * 1024;

export interface WorkspaceFilePreviewUrlOptions {
  modifiedAt?: string;
  machineId?: string;
  download?: boolean;
}

export type WorkspaceFilePreviewUrlBuilder = (
  projectId: string,
  workspaceId: string,
  path: string,
  options?: WorkspaceFilePreviewUrlOptions,
) => string;

type WorkspaceFileMetadataKind = "image" | "html" | "pdf" | "markdown" | "download" | "code";

export interface WorkspaceFileViewerIdentity {
  machineId: string;
  projectId: string;
  workspaceId: string;
  selectedPath: string | undefined;
  file: FileContentResponse | undefined;
}

export class WorkspaceFileViewer extends LitElement {
  private readonly text = new FilesLocalizationController(this);
  @property({ attribute: false })
  get content(): FilesContent | undefined { return this.text.content; }
  set content(value: FilesContent | undefined) { this.text.content = value; }

  private integration: StylesheetIntegrationCapabilityV1 | undefined;
  private releaseStyles: (() => void) | undefined;

  @property({ attribute: false })
  get stylesheetIntegration(): StylesheetIntegrationCapabilityV1 | undefined { return this.integration; }
  set stylesheetIntegration(value: StylesheetIntegrationCapabilityV1 | undefined) {
    if (value === this.integration) return;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    this.integration = value;
    if (this.isConnected && this.renderRoot instanceof ShadowRoot) this.releaseStyles = value?.registerRoot(this.renderRoot);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.renderRoot instanceof ShadowRoot) this.releaseStyles ??= this.integration?.registerRoot(this.renderRoot);
  }

  override disconnectedCallback(): void {
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    this.previewGeneration += 1;
    this.activePreviewerId = undefined;
    super.disconnectedCallback();
  }

  @property({ attribute: false }) machineId = "";
  @property({ attribute: false }) filePreviewing: FilePreviewingCapability | undefined;
  @property({ attribute: false }) loadViewerDependencies: FilesViewerLoader | undefined;
  @property({ attribute: false }) files: WorkspaceFilesContextValue | undefined;
  @property({ attribute: false }) projectId = "";
  @property({ attribute: false }) workspaceId = "";
  @property({ attribute: false }) selectedPath: string | undefined;
  @property({ attribute: false }) file: FileContentResponse | undefined;
  @property({ attribute: false }) loadError: string | undefined;
  @property({ attribute: false }) previewUrlBuilder: WorkspaceFilePreviewUrlBuilder = () => "about:blank";
  @property({ attribute: false }) modeStore: WorkspaceFileViewModeStore = workspaceFileViewModeStore;
  @property({ attribute: false }) maxInlinePreviewBytes = DEFAULT_MAX_INLINE_PREVIEW_BYTES;

  /** Undefined until the first render adopts the deep-linked or stored mode. */
  private mode: WorkspaceFileViewMode | undefined;
  private publishedMode: WorkspaceFileViewMode | undefined;
  private activeFileKey: string | undefined;
  /**
   * Increments on every selected-file identity change. Rendered handlers carry
   * the token of the selection they belong to, so a delayed event from detached
   * markup can never affect a later selection — including when the user returns
   * to a file whose identity key is identical (A → B → A).
   */
  private selectionToken = 0;
  private preference: WorkspaceFileViewMode | undefined;
  private previewerOptions: readonly FilePreviewerOption[] = [];
  // Undefined adopts the preference/default; null explicitly keeps source/download.
  private previewerChoice: string | null | undefined;
  private activePreviewerId: string | undefined;
  private previewGeneration = 0;
  private previewerFailed = false;
  private previewerFail: (error: unknown) => void = () => undefined;

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    if (this.mode === undefined || changedProperties.has("modeStore")) {
      this.preference = this.modeStore.adopt();
      this.mode = this.preference ?? DEFAULT_WORKSPACE_FILE_VIEW_MODE;
      this.publishedMode = undefined;
    }
    const nextKey = this.currentFileKey();
    if (nextKey === this.activeFileKey) return;
    this.activeFileKey = nextKey;
    this.previewerChoice = undefined;
    this.activePreviewerId = undefined;
    this.previewGeneration += 1;
    this.previewerFailed = false;
    this.selectionToken += 1;
  }

  /**
   * Publish explicit preferences for reproducible links, but never promote a
   * plugin's initial default into a saved user choice.
   */
  protected override updated(): void {
    const mode = this.mode;
    if (this.preference === undefined || mode === undefined || mode === this.publishedMode) return;
    if (!this.selectionHasRawAndPreviewModes()) return;
    this.publishedMode = mode;
    this.modeStore.publish(mode);
  }

  override render(): TemplateResult {
    if (this.content === undefined) return html``;
    const selectedPath = this.selectedPath;
    if (selectedPath === undefined || selectedPath === "") return this.renderStatus(this.text.messages.t("selectFile"));
    if (this.loadError !== undefined) return this.renderStatus(this.text.messages.t("loadFailed", { path: selectedPath, error: this.loadError }), true);

    const file = this.file;
    if (file === undefined) return this.renderStatus(this.text.messages.t("loadingFile", { path: selectedPath }));
    if (file.path !== selectedPath) {
      return this.renderStatus(this.text.messages.t("wrongFile", { selected: selectedPath, loaded: file.path }), true);
    }

    const kind = workspaceFileMetadataKind(file);
    const pluginPreview = this.renderFilePreview(file);
    const canOpen = isBrowserPreviewKind(kind) && file.size > 0 && file.size <= this.maxInlinePreviewBytes;
    return html`
      ${this.renderViewerHeader(file, metadataForFile(file, kind, this.requireContent()), canOpen)}
      ${this.previewerFailed ? this.renderStatus(this.text.messages.t("previewFailed", { path: file.path }), true) : null}
      ${keyed(this.activeFileKey, pluginPreview ?? (file.binary ? this.renderUnsupportedFile(file) : this.renderRawSource(file)))}
    `;
  }

  private renderFilePreview(file: FileContentResponse): TemplateResult | undefined {
    const request = { machineId: this.machineId, projectId: this.projectId, workspaceId: this.workspaceId, file };
    this.previewerOptions = this.filePreviewing?.listPreviewers(request) ?? [];
    const automatic = this.previewerOptions.filter(({ renderMode }) => renderMode === "automatic").at(-1);
    const selected = this.previewerChoice === undefined
      ? this.preference === "raw" && !file.binary ? undefined
        : (automatic ?? (this.preference === "preview" ? this.previewerOptions[0] : undefined))?.id
      : this.previewerChoice ?? undefined;
    const id = this.previewerOptions.some((option) => option.id === selected) ? selected : undefined;
    if (id !== this.activePreviewerId) {
      this.activePreviewerId = id;
      const generation = ++this.previewGeneration;
      this.previewerFail = (error) => {
        if (!this.isConnected || generation !== this.previewGeneration) return;
        console.warn("File preview failed", file.path, error);
        this.previewerChoice = null;
        this.activePreviewerId = undefined;
        this.previewGeneration += 1;
        this.previewerFailed = true;
        this.requestUpdate();
      };
    }
    if (id === undefined || this.files === undefined) return undefined;
    try {
      const preview = this.filePreviewing?.renderPreview({ ...request, previewerId: id, files: this.files, fail: this.previewerFail });
      return this.previewerFailed ? undefined : preview;
    } catch (error) {
      this.previewerFail(error);
      return undefined;
    }
  }

  private renderViewerHeader(file: FileContentResponse, metadata: string, canOpen: boolean): TemplateResult {
    const name = workspaceFileName(file.path);
    const previewOptions = { modifiedAt: file.modifiedAt, machineId: this.machineId };
    const openUrl = this.previewUrlBuilder(this.projectId, this.workspaceId, file.path, previewOptions);
    const downloadUrl = this.previewUrlBuilder(this.projectId, this.workspaceId, file.path, { ...previewOptions, download: true });
    return html`
      <div class="viewer-header">
        <strong dir="ltr" title=${file.path}>${file.path}</strong>
        <div class="viewer-actions">
          <small>${metadata}</small>
          ${this.selectionHasRawAndPreviewModes() || this.previewerOptions.length > 0 ? this.renderModeControls(file, this.selectionToken) : null}
          ${canOpen ? html`
            <a
              class="viewer-action"
              href=${openUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerpolicy="no-referrer"
              title=${this.text.messages.t("openTitle")}
            >${this.text.messages.t("open")}</a>
          ` : null}
          <a class="viewer-action" href=${downloadUrl} download=${name} title=${this.text.messages.t("downloadTitle", { name })}>${this.text.messages.t("download")}</a>
        </div>
      </div>
    `;
  }

  private renderModeControls(file: FileContentResponse, token: number): TemplateResult {
    return html`
      <div class="viewer-mode" role="group" aria-label=${this.text.messages.t("view", { path: file.path })}>
        ${this.previewerOptions.map(({ id, label, title }) => html`
          <button type="button" title=${ifDefined(title)} aria-pressed=${String(id === this.activePreviewerId)} @click=${() => {
            if (token !== this.selectionToken) return;
            this.previewerChoice = id;
            if (!file.binary) { this.mode = "preview"; this.preference = "preview"; }
            this.activePreviewerId = undefined;
            this.previewGeneration += 1;
            this.previewerFailed = false;
            this.requestUpdate();
          }}>${label}</button>
        `)}
        ${file.binary ? null : html`<button type="button" aria-pressed=${String(this.activePreviewerId === undefined)}
          @click=${() => { this.setMode("raw", token); }}>${this.text.messages.t("raw")}</button>`}
      </div>
    `;
  }

  private renderRawSource(file: FileContentResponse): TemplateResult {
    if (file.size === 0) return this.renderStatus(this.text.messages.t("empty"));
    return html`
      ${file.truncated ? html`<p class="preview-note" role="status">${this.text.messages.t("rawTruncated")}</p>` : null}
      <pi-web-files-code-viewer
        .stylesheetIntegration=${this.stylesheetIntegration}
        .content=${file.content}
        .language=${file.language}
        .loadViewerDependencies=${this.loadViewerDependencies}
        .loadingLabel=${this.text.messages.t("loadingFile", { path: file.path })}
        .failureLabel=${this.text.messages.t("previewFailed", { path: file.path })}
      ></pi-web-files-code-viewer>
    `;
  }

  private renderUnsupportedFile(file: FileContentResponse): TemplateResult {
    const name = workspaceFileName(file.path);
    const href = this.previewUrlBuilder(this.projectId, this.workspaceId, file.path, {
      modifiedAt: file.modifiedAt,
      machineId: this.machineId,
      download: true,
    });
    return html`
      <div class="preview-state">
        <p>${this.text.messages.t("unsupported")}</p>
        <a class="download-link" href=${href} download=${name}>${this.text.messages.t("downloadSize", { name, size: formatFileSize(file.size, this.requireContent()) })}</a>
      </div>
    `;
  }

  private renderStatus(message: string, alert = false): TemplateResult {
    return alert
      ? html`<p class="viewer-status" role="alert">${message}</p>`
      : html`<p class="viewer-status" role="status" aria-live="polite">${message}</p>`;
  }

  private setMode(mode: WorkspaceFileViewMode, token: number): void {
    if (token !== this.selectionToken) return;
    this.previewerChoice = null;
    this.activePreviewerId = undefined;
    this.previewGeneration += 1;
    this.previewerFailed = false;
    // Only source-file views participate in the remembered Raw/Preview preference.
    if (this.file?.binary !== true) {
      this.mode = mode;
      this.preference = mode;
    }
    this.requestUpdate();
  }

  private currentFileKey(): string {
    return workspaceFileViewerIdentityKey(this);
  }

  private selectionHasRawAndPreviewModes(): boolean {
    const file = this.file;
    if (file === undefined || this.loadError !== undefined) return false;
    if (this.selectedPath === undefined || file.path !== this.selectedPath) return false;
    return !file.binary && this.previewerOptions.length > 0;
  }

  private requireContent(): FilesContent {
    if (this.content === undefined) throw new Error("Files localization is unavailable");
    return this.content;
  }

  static override styles = [
    css`
    @layer pi-web-base {
      :host { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: auto; color: var(--pi-text); font: 14px var(--pi-font, system-ui, sans-serif); }
      .viewer-header { position: sticky; top: 0; z-index: 1; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; padding: 0; padding-inline-start: 10px; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
      .viewer-header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; }
      .viewer-actions { align-self: stretch; display: flex; align-items: center; gap: 0; flex: 0 1 auto; min-width: 0; max-width: 100%; }
      .viewer-actions > small { padding-inline: 8px; }
      small { color: var(--pi-muted); }
      .viewer-action, .download-link { flex: 0 0 auto; border: 1px solid var(--pi-border-muted); border-radius: 6px; background: var(--pi-surface); color: var(--pi-text); text-decoration: none; white-space: nowrap; }
      .viewer-action { padding: 3px 8px; font-size: 12px; }
      .viewer-action:hover, .download-link:hover { border-color: var(--pi-border); background: var(--pi-bg); }
      .viewer-mode { align-self: stretch; flex: 0 1 auto; min-width: 0; display: flex; gap: 0; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; }
      .viewer-mode button { flex: 0 0 auto; white-space: nowrap; }
      .viewer-mode button, .preview-state button { border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-text); padding: 4px 9px; cursor: pointer; font: inherit; }
      .viewer-mode button, .viewer-actions .viewer-action { box-sizing: border-box; align-self: stretch; display: inline-flex; align-items: center; min-height: 32px; border: 0; border-radius: 0; background: transparent; color: var(--pi-muted); font: 12px/20px var(--pi-font, system-ui, sans-serif); padding: 6px 8px; }
      .viewer-actions > :not(small) + *, .viewer-mode button + button { border-inline-start: 1px solid var(--pi-border-muted); }
      .viewer-mode button:hover, .viewer-actions .viewer-action:hover { background: var(--pi-surface-hover); color: var(--pi-text); }
      .viewer-mode button[aria-pressed="true"] { background: var(--pi-surface-hover); color: var(--pi-text); }
      .viewer-actions button:focus-visible, .viewer-actions a:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
      .preview-state button:focus-visible, a:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
      pi-web-files-code-viewer { flex: 1 1 auto; min-height: 0; }
      .preview-note { flex: 0 0 auto; margin: 0; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-surface); color: var(--pi-muted); padding: 7px 10px; font-size: 12px; }
      .viewer-status { box-sizing: border-box; margin: auto; max-width: 100%; color: var(--pi-muted); padding: 18px; text-align: center; overflow-wrap: anywhere; }
      .preview-state { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; box-sizing: border-box; padding: 24px; color: var(--pi-muted); text-align: center; }
      .preview-state strong { color: var(--pi-text); }
      .preview-state p { margin: 0; }
      .download-link { display: inline-block; padding: 8px 16px; font-size: 13px; }
      @media (max-width: 640px) {
        .viewer-header { align-items: flex-start; flex-direction: column; gap: 0; padding-inline: 0; }
        .viewer-header strong { box-sizing: border-box; max-width: 100%; padding: 6px 10px; }
        .viewer-actions { width: 100%; }
      }

    }
  `,
  ];
}

/** Stable state key for mode and embedded-preview failure ownership. */
export function workspaceFileViewerIdentityKey(identity: WorkspaceFileViewerIdentity): string {
  return JSON.stringify([
    identity.machineId,
    identity.projectId,
    identity.workspaceId,
    identity.selectedPath ?? null,
    identity.file?.path ?? null,
    identity.file?.modifiedAt ?? null,
    identity.file?.mediaType ?? null,
  ]);
}

function workspaceFileMetadataKind(file: FileContentResponse): WorkspaceFileMetadataKind {
  if (file.mediaType === "image") return "image";
  if (file.mediaType === "html") return "html";
  if (file.mediaType === "pdf") return "pdf";
  if (file.mediaType === "markdown") return "markdown";
  if (file.binary) return "download";
  return "code";
}

function isBrowserPreviewKind(kind: WorkspaceFileMetadataKind): kind is "image" | "html" | "pdf" {
  return kind === "image" || kind === "html" || kind === "pdf";
}

function metadataForFile(file: FileContentResponse, kind: WorkspaceFileMetadataKind, content: FilesContent): string {
  const format = kind === "code"
    ? file.language ?? "text"
    : kind === "download"
      ? file.mimeType ?? "binary"
      : kind === "markdown"
        ? "markdown"
        : file.mimeType ?? kind;
  return content.messages.t("metadata", { format, size: formatFileSize(file.size, content), truncated: file.truncated ? "yes" : "no" });
}

function workspaceFileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

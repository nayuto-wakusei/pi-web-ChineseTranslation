import { t } from "../i18n.js";
import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { FileContentResponse, FileTreeEntry } from "../api";
import { workspaceImagePreviewUrl } from "../api/urls";
import { workspaceUploadPath } from "../api/workspaceUploads";
import type { WorkspaceUploadBatchState, WorkspaceUploadFileState } from "../workspaceUploadState";
import { MAX_IMAGE_PREVIEW_BYTES, MAX_IMAGE_PREVIEW_LABEL } from "../../../shared/workspaceFiles";
import type { WorkspacePanelContext } from "../plugins/types";
import { workspacePanelStyles } from "./shared";
import { renderDeleteIcon, renderDownloadIcon, renderNewFileIcon, renderNewFolderIcon, renderRefreshIcon, renderRenameIcon, renderUploadIcon } from "./workspaceFileIcons";

interface PendingWorkspaceUploadReview {
  files: File[];
}

export interface WorkspaceUploadScope {
  projectId: string;
  workspaceId: string;
  machineId: string;
}

@customElement("workspace-files-panel")
export class WorkspaceFilesPanel extends LitElement {
  @property({ attribute: false }) context: WorkspacePanelContext | undefined;
  @query("#workspace-upload-input") private uploadInput?: HTMLInputElement;
  @state() private pendingUpload: PendingWorkspaceUploadReview | undefined;
  @state() private destinationFolder = "";
  @state() private overwrite = false;
  @state() private createDirs = true;
  @state() private formError = "";
  @state() private dragActive = false;
  private dragDepth = 0;

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    if (!changedProperties.has("context")) return;
    const previous = changedProperties.get("context");
    if (previous !== undefined && this.context !== undefined && workspaceContextKey(previous) !== workspaceContextKey(this.context)) this.resetPendingUpload();
  }

  override render(): TemplateResult {
    const context = this.context;
    if (context === undefined) return html`<p class="muted">${t("ui.workspaceFilesPanel.filesUnavailable", "Files unavailable.")}</p>`;
    const selectedPath = context.selectedFilePath;
    const selectedKind = selectedWorkspacePathKind(context.fileTree, context.expandedDirs, selectedPath);
    const hasSelection = selectedPath !== undefined && selectedPath !== "";
    const canDownload = hasSelection && selectedKind === "file";
    return html`
      <section
        class=${this.dragActive ? "files-panel dragging" : "files-panel"}
        @dragenter=${this.handleDragEnter}
        @dragover=${this.handleDragOver}
        @dragleave=${this.handleDragLeave}
        @drop=${this.handleDrop}
      >
        <section class="toolbar">
          <strong>${t("ui.workspaceFilesPanel.file", "File")}</strong>
          ${context.fileTreeStale ? html`<span class="stale">${t("ui.workspaceFilesPanel.stale", "Stale")}</span>` : null}
          <div class="toolbar-actions">
            <button class="icon-button" title=${t("ui.workspaceFilesPanel.newFile", "New file")} aria-label=${t("ui.workspaceFilesPanel.newFile", "New file")} @click=${() => { this.promptCreateFile(context, selectedKind); }}>${renderNewFileIcon()}</button>
            <button class="icon-button" title=${t("ui.workspaceFilesPanel.newFolder", "New folder")} aria-label=${t("ui.workspaceFilesPanel.newFolder", "New folder")} @click=${() => { this.promptCreateDirectory(context, selectedKind); }}>${renderNewFolderIcon()}</button>
            <button class="icon-button" title=${t("ui.workspaceFilesPanel.uploadFiles", "Upload files")} aria-label=${t("ui.workspaceFilesPanel.uploadFiles", "Upload files")} @click=${this.openFilePicker}>${renderUploadIcon()}</button>
            <button class="icon-button" aria-label=${t("ui.workspaceFilesPanel.downloadFile", "Download file")} title=${canDownload ? t("ui.workspaceFilesPanel.download", "Download {selectedPath}", { selectedPath: selectedPath }) : t("ui.workspaceFilesPanel.selectAFileToDownload", "Select a file to download")} ?disabled=${!canDownload} @click=${context.onDownloadSelectedFile}>${renderDownloadIcon()}</button>
            <button class="icon-button" aria-label=${t("ui.workspaceFilesPanel.moveOrRename2", "Move or rename")} title=${hasSelection ? t("ui.workspaceFilesPanel.moveOrRename", "Move or rename {selectedPath}", { selectedPath: selectedPath }) : t("ui.workspaceFilesPanel.selectAFileOrFolderToMoveOr", "Select a file or folder to move or rename")} ?disabled=${!hasSelection} @click=${() => { this.promptMoveSelectedPath(context, selectedKind); }}>${renderRenameIcon()}</button>
            <button class="icon-button danger" aria-label=${t("ui.workspaceFilesPanel.deleteFileOrFolder", "Delete file or folder")} title=${hasSelection ? t("ui.workspaceFilesPanel.delete", "Delete {selectedPath}", { selectedPath: selectedPath }) : t("ui.workspaceFilesPanel.selectAFileOrFolderToDelete", "Select a file or folder to delete")} ?disabled=${!hasSelection} @click=${() => { this.confirmDeleteSelectedPath(context, selectedKind); }}>${renderDeleteIcon()}</button>
            <button class="icon-button" title=${t("ui.workspaceFilesPanel.refresh", "Refresh")} aria-label=${t("ui.workspaceFilesPanel.refresh", "Refresh")} @click=${context.onRefreshFiles}>${renderRefreshIcon()}</button>
          </div>
          <input id="workspace-upload-input" class="visually-hidden" type="file" multiple hidden @change=${this.handleFileInputChange} />
        </section>
        ${this.renderUploadProgress(context)}
        <section class="split">
          <div class="list tree">
            ${context.fileTree.length === 0 ? html`<p class="muted">${t("ui.workspaceFilesPanel.noFilesLoaded", "No files loaded.")}</p>` : context.fileTree.map((entry) => this.renderTreeEntry(context, entry, 0))}
          </div>
          <div class="viewer">
            ${this.renderFileViewer(context)}
          </div>
        </section>
        <div class="drop-overlay" aria-hidden=${this.dragActive ? "false" : "true"}>
          <div>
            <strong>${t("ui.workspaceFilesPanel.dropFilesToUpload", "Drop files to upload")}</strong>
            <span>${t("ui.workspaceFilesPanel.filesWillUploadImmediatelyToTheDefaultFolder", "Files will upload immediately to the default folder.")}</span>
          </div>
        </div>
        ${this.pendingUpload === undefined ? null : this.renderUploadDialog(context, this.pendingUpload)}
      </section>
    `;
  }

  private renderTreeEntry(context: WorkspacePanelContext, entry: FileTreeEntry, depth: number): TemplateResult {
    const children = context.expandedDirs[entry.path];
    const hasChildren = children !== undefined;
    const selected = context.selectedFilePath === entry.path;
    return html`
      <button class=${selected ? "row selected" : "row"} style=${`--depth:${String(depth)}`} @click=${() => { this.selectTreeEntry(context, entry); }}>
        <span>${entry.type === "directory" ? (hasChildren ? "▾" : "▸") : "·"}</span>
        <span>${entry.name}</span>
      </button>
      ${hasChildren ? children.map((child) => this.renderTreeEntry(context, child, depth + 1)) : null}
    `;
  }

  private selectTreeEntry(context: WorkspacePanelContext, entry: FileTreeEntry): void {
    if (entry.type === "directory") {
      context.onSelectDirectory(entry.path);
      context.onExpandDir(entry.path);
      return;
    }
    context.onSelectFile(entry.path);
  }

  private renderFileViewer(context: WorkspacePanelContext): TemplateResult {
    if (selectedWorkspacePathKind(context.fileTree, context.expandedDirs, context.selectedFilePath) === "directory") {
      return html`<p class="muted">${t("ui.workspaceFilesPanel.selectedFolderPath", "Selected folder: {path}", { path: context.selectedFilePath ?? "" })}</p>`;
    }
    const status = workspaceFileViewerStatusLabel(context);
    if (status !== undefined) return html`<p class="muted">${status}</p>`;
    const file = context.selectedFileContent;
    // workspaceFileViewerStatusLabel already returned for the undefined/binary
    // cases above; this guard only narrows the type for the code viewer path.
    if (file === undefined) return html`<p class="muted">${t("ui.workspaceFilesPanel.selectAFile", "Select a file.")}</p>`;
    if (file.mediaType === "image") return this.renderImageViewer(context, file);
    loadCodeViewer();
    return html`
      <div class="viewer-header"><strong>${file.path}</strong><small>${file.language ?? t("ui.workspaceFilesPanel.text", "Text")}${file.truncated ? t("ui.workspaceFilesPanel.truncated", " · Truncated") : ""}</small></div>
      <code-viewer .content=${file.content} .language=${file.language}></code-viewer>
    `;
  }

  private renderImageViewer(context: WorkspacePanelContext, file: FileContentResponse): TemplateResult {
    const metadata = `${file.mimeType ?? "image"} · ${formatFileSize(file.size)}`;
    if (file.size > MAX_IMAGE_PREVIEW_BYTES) {
      return html`
        <div class="viewer-header"><strong>${file.path}</strong><small>${metadata}</small></div>
        <p class="muted">${t("ui.workspaceFilesPanel.imagePreviewLimit", "Image too large to preview: {size} · Limit {limit}", { size: formatFileSize(file.size), limit: MAX_IMAGE_PREVIEW_LABEL })}</p>
      `;
    }
    const src = workspaceImagePreviewUrl(context.workspace.projectId, context.workspace.id, file.path, { modifiedAt: file.modifiedAt, machineId: context.machine.id });
    return html`
      <div class="viewer-header"><strong>${file.path}</strong><small>${metadata}</small></div>
      <div class="image-preview">
        <img src=${src} alt=${file.path} decoding="async" />
      </div>
    `;
  }

  private renderUploadProgress(context: WorkspacePanelContext): TemplateResult | null {
    const batches = workspaceUploadBatchesForScope(context.state.workspaceUploadBatches, {
      projectId: context.workspace.projectId,
      workspaceId: context.workspace.id,
      machineId: context.machine.id,
    });
    if (batches.length === 0) return null;
    return html`
      <section class="upload-progress" aria-label=${t("ui.workspaceFilesPanel.workspaceUploads", "Workspace uploads")}>
        <div class="upload-progress-header">
          <strong>${t("ui.workspaceFilesPanel.upload", "Upload")}</strong>
          <small>${uploadSummaryLabel(batches)}</small>
        </div>
        ${batches.map((batch) => this.renderUploadBatch(context, batch))}
      </section>
    `;
  }

  private renderUploadBatch(context: WorkspacePanelContext, batch: WorkspaceUploadBatchState): TemplateResult {
    return html`
      <article class=${`upload-batch ${batch.status}`}>
        <div class="upload-batch-heading">
          <div>
            <strong>${uploadBatchTitle(batch)}</strong>
            <small>${batch.destinationFolder === "" ? t("ui.workspaceFilesPanel.workspaceRoot", "Workspace root") : batch.destinationFolder}</small>
          </div>
          <span>${uploadBatchStatusLabel(batch)}</span>
        </div>
        <progress max="1" .value=${uploadBatchProgressValue(batch)}></progress>
        <div class="upload-file-list">
          ${batch.files.map((file) => this.renderUploadFile(file))}
        </div>
        <div class="upload-actions">
          ${batch.status === "uploading" ? html`<button @click=${() => { context.onCancelWorkspaceUpload(batch.id); }}>${t("ui.workspaceFilesPanel.cancel", "Cancel")}</button>` : html`<button @click=${() => { context.onClearWorkspaceUpload(batch.id); }}>${t("ui.workspaceFilesPanel.close", "Close")}</button>`}
        </div>
      </article>
    `;
  }

  private renderUploadFile(file: WorkspaceUploadFileState): TemplateResult {
    const detail = uploadFileDetail(file);
    return html`
      <div class=${`upload-file ${file.status}`}>
        <div class="upload-file-main">
          <span>${file.name}</span>
          <small>${detail}</small>
        </div>
        <span class="upload-file-status">${uploadFileStatusLabel(file)}</span>
      </div>
    `;
  }

  private renderUploadDialog(context: WorkspacePanelContext, review: PendingWorkspaceUploadReview): TemplateResult {
    const fileCount = review.files.length;
    return html`
      <div class="dialog-backdrop" @mousedown=${() => { this.closeUploadDialog(); }}>
        <section class="upload-dialog" role="dialog" aria-modal="true" aria-label=${t("ui.workspaceFilesPanel.reviewFileUpload", "Review file upload")} @mousedown=${(event: MouseEvent) => { event.stopPropagation(); }} @keydown=${this.handleDialogKeyDown}>
          <header>
            <div>
              <span class="eyebrow">${t("ui.workspaceFilesPanel.upload", "Upload")}</span>
              <h2>${t("ui.workspaceFilesPanel.review", "Review ")}${fileCount === 1 ? t("ui.workspaceFilesPanel.file", "File") : t("ui.workspaceFilesPanel.files", " {fileCount} files", { fileCount: String(fileCount) })}</h2>
            </div>
            <button class="close-button" title=${t("ui.workspaceFilesPanel.cancelUpload", "Cancel upload")} aria-label=${t("ui.workspaceFilesPanel.cancelUpload", "Cancel upload")} @click=${() => { this.closeUploadDialog(); }}>×</button>
          </header>
          <form @submit=${(event: SubmitEvent) => { this.submitUploadReview(event, context, review); }}>
            <label>
              <span>${t("ui.workspaceFilesPanel.destinationFolder", "Destination folder")}</span>
              <input .value=${this.destinationFolder} placeholder=${context.workspaceUploadDefaultFolder} @input=${this.handleDestinationInput} />
              <small>${t("ui.workspaceFilesPanel.relativeToTheWorkspaceLeaveBlankToUpload", "Relative to the workspace. Leave blank to upload to the workspace root.")}</small>
            </label>
            <div class="dialog-options">
              <label>
                <input type="checkbox" .checked=${this.createDirs} @change=${this.handleCreateDirsChange} />
                <span>${t("ui.workspaceFilesPanel.createParentFolders", "Create parent folders")}</span>
              </label>
              <label>
                <input type="checkbox" .checked=${this.overwrite} @change=${this.handleOverwriteChange} />
                <span>${t("ui.workspaceFilesPanel.overwriteExistingFiles", "Overwrite existing files")}</span>
              </label>
            </div>
            <section class="review-files" aria-label=${t("ui.workspaceFilesPanel.filesToUpload", "Files to upload")}>
              <strong>${t("ui.workspaceFilesPanel.file", "File")}</strong>
              ${review.files.map((file) => html`
                <div class="review-file">
                  <span>${file.name}</span>
                  <small>${formatFileSize(file.size)}</small>
                </div>
              `)}
            </section>
            ${this.formError === "" ? null : html`<div class="dialog-error" role="alert">${this.formError}</div>`}
            <footer>
              <button type="button" @click=${() => { this.closeUploadDialog(); }}>${t("ui.workspaceFilesPanel.cancel", "Cancel")}</button>
              <button type="submit">${t("ui.workspaceFilesPanel.upload", "Upload")}</button>
            </footer>
          </form>
        </section>
      </div>
    `;
  }

  private readonly openFilePicker = (): void => {
    this.uploadInput?.click();
  };

  private promptCreateFile(context: WorkspacePanelContext, selectedKind: FileTreeEntry["type"] | undefined): void {
    const path = promptWorkspacePath(t("ui.workspaceFilesPanel.newFilePath", "New file path"), workspaceNewPathDefault(context.selectedFilePath, selectedKind, "new-file.txt"));
    if (path !== undefined) context.onCreateFile(path);
  }

  private promptCreateDirectory(context: WorkspacePanelContext, selectedKind: FileTreeEntry["type"] | undefined): void {
    const path = promptWorkspacePath(t("ui.workspaceFilesPanel.newFolderPath", "New folder path"), workspaceNewPathDefault(context.selectedFilePath, selectedKind, "new-folder"));
    if (path !== undefined) context.onCreateDirectory(path);
  }

  private promptMoveSelectedPath(context: WorkspacePanelContext, selectedKind: FileTreeEntry["type"] | undefined): void {
    const current = context.selectedFilePath;
    if (current === undefined || current === "") return;
    const label = selectedKind === "directory" ? t("ui.workspaceFilesPanel.moveOrRenameFolderTo", "Move or rename folder to") : t("ui.workspaceFilesPanel.moveOrRenameFileTo", "Move or rename file to");
    const path = promptWorkspacePath(label, current);
    if (path !== undefined && path !== current) context.onMoveSelectedPath(path);
  }

  private confirmDeleteSelectedPath(context: WorkspacePanelContext, selectedKind: FileTreeEntry["type"] | undefined): void {
    const current = context.selectedFilePath;
    if (current === undefined || current === "") return;
    const kind = selectedKind === "directory" ? t("ui.workspaceFilesPanel.emptyFolder", "empty folder") : t("ui.workspaceFilesPanel.file", "File");
    if (window.confirm(t("ui.workspaceFilesPanel.deleteThisCannotBeUndone", "Delete {kind} {current}? This cannot be undone.", { kind: kind, current: current }))) context.onDeleteSelectedPath();
  }

  private readonly handleFileInputChange = (event: Event): void => {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined;
    const files = fileListToArray(input?.files);
    if (input !== undefined) input.value = "";
    if (files.length > 0) this.openUploadReview(files);
  };

  private readonly handleDragEnter = (event: DragEvent): void => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth += 1;
    this.dragActive = true;
  };

  private readonly handleDragOver = (event: DragEvent): void => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    this.dragActive = true;
  };

  private readonly handleDragLeave = (event: DragEvent): void => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dragActive = false;
  };

  private readonly handleDrop = (event: DragEvent): void => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dragActive = false;
    const files = fileListToArray(event.dataTransfer?.files);
    const context = this.context;
    if (files.length > 0 && context !== undefined) startDirectWorkspaceUpload(context, files);
  };

  private readonly handleDestinationInput = (event: Event): void => {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined;
    this.destinationFolder = input?.value ?? "";
    this.formError = "";
  };

  private readonly handleCreateDirsChange = (event: Event): void => {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined;
    this.createDirs = input?.checked ?? true;
  };

  private readonly handleOverwriteChange = (event: Event): void => {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined;
    this.overwrite = input?.checked ?? false;
  };

  private readonly handleDialogKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    this.closeUploadDialog();
  };

  private openUploadReview(files: File[]): void {
    const context = this.context;
    const defaults = workspaceUploadReviewDefaults(context?.workspaceUploadDefaultFolder ?? "");
    this.pendingUpload = { files };
    this.destinationFolder = defaults.destinationFolder;
    this.overwrite = defaults.overwrite;
    this.createDirs = defaults.createDirs;
    this.formError = "";
  }

  private submitUploadReview(event: SubmitEvent, context: WorkspacePanelContext, review: PendingWorkspaceUploadReview): void {
    event.preventDefault();
    const validationError = workspaceUploadReviewError(review.files, this.destinationFolder);
    if (validationError !== undefined) {
      this.formError = validationError;
      return;
    }
    const run = context.onStartWorkspaceUpload(review.files, {
      destinationFolder: this.destinationFolder,
      createDirs: this.createDirs,
      overwrite: this.overwrite,
      selectUploadedFile: true,
    });
    if (run !== undefined) this.closeUploadDialog();
  }

  private closeUploadDialog(): void {
    this.pendingUpload = undefined;
    this.formError = "";
  }

  private resetPendingUpload(): void {
    this.closeUploadDialog();
    this.dragDepth = 0;
    this.dragActive = false;
  }

  static override styles = [
    workspacePanelStyles,
    css`
      :host { flex: 1 1 auto; }
      .files-panel { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
      .toolbar { min-width: 0; }
      .toolbar > strong { flex: 0 0 auto; white-space: nowrap; }
      .toolbar-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: nowrap; gap: 4px; min-width: 0; margin-left: auto; }
      .toolbar .toolbar-actions button { margin-left: 0; }
      .toolbar .toolbar-actions .icon-button { flex: 0 0 auto; display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; }
      .file-action-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
      .toolbar .toolbar-actions button.danger { color: var(--pi-danger); }
      .toolbar .toolbar-actions button.danger:not(:disabled):hover { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
      .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
      .drop-overlay { position: absolute; inset: 52px 10px 10px; z-index: 15; display: grid; place-items: center; border: 2px dashed var(--pi-accent); border-radius: 12px; background: color-mix(in srgb, var(--pi-bg-overlay) 90%, var(--pi-accent) 10%); color: var(--pi-text); opacity: 0; pointer-events: none; transition: opacity .12s ease; }
      .files-panel.dragging .drop-overlay { opacity: 1; }
      .drop-overlay div { display: grid; gap: 4px; justify-items: center; padding: 18px; border-radius: 10px; background: var(--pi-bg-overlay); box-shadow: 0 8px 24px var(--pi-shadow); }
      .drop-overlay span { color: var(--pi-muted); }
      .upload-progress { flex: 0 0 auto; display: grid; gap: 8px; padding: 8px; border-bottom: 1px solid var(--pi-border-muted); background: color-mix(in srgb, var(--pi-surface) 55%, transparent); }
      .upload-progress-header, .upload-batch-heading, .upload-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .upload-batch { display: grid; gap: 6px; border: 1px solid var(--pi-border-muted); border-radius: 8px; background: var(--pi-bg); padding: 8px; }
      .upload-batch.error { border-color: var(--pi-danger); }
      .upload-batch.cancelled { border-color: var(--pi-warning-border); }
      .upload-batch.completed { border-color: var(--pi-success-border); }
      .upload-batch-heading > div { min-width: 0; display: grid; gap: 2px; }
      .upload-batch-heading strong, .upload-batch-heading small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      progress { width: 100%; accent-color: var(--pi-accent); }
      .upload-file-list { display: grid; gap: 4px; max-height: 180px; overflow: auto; padding-right: 2px; }
      .upload-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; color: var(--pi-muted); }
      .upload-file.completed .upload-file-status { color: var(--pi-success); }
      .upload-file.error { color: var(--pi-danger); }
      .upload-file.cancelled .upload-file-status { color: var(--pi-warning); }
      .upload-file-main { min-width: 0; display: grid; gap: 1px; }
      .upload-file-main span, .upload-file-main small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .upload-file-status { font-size: 12px; white-space: nowrap; }
      .upload-actions { justify-content: end; }
      .dialog-backdrop { position: fixed; inset: 0; z-index: 100; box-sizing: border-box; display: grid; place-items: center; padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); background: var(--pi-overlay); }
      .upload-dialog { box-sizing: border-box; width: min(560px, 100%); max-height: min(720px, 100%); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--pi-border); border-radius: 14px; background: var(--pi-bg); box-shadow: 0 18px 70px var(--pi-shadow-strong); }
      .upload-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--pi-border-muted); }
      .upload-dialog h2 { margin: 2px 0 0; font-size: 18px; line-height: 1.2; }
      .eyebrow { color: var(--pi-muted); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
      .close-button { font-size: 20px; line-height: 1; padding: 4px 9px; }
      form { min-height: 0; display: flex; flex-direction: column; gap: 12px; overflow: auto; padding: 16px; }
      form > label { display: grid; gap: 6px; }
      form > label > span, .review-files > strong { font-weight: 600; }
      input[type="text"], form > label > input:not([type]) { box-sizing: border-box; width: 100%; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 8px 9px; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
      input:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
      .dialog-options { display: grid; gap: 8px; }
      .dialog-options label { display: flex; align-items: center; gap: 8px; color: var(--pi-text); }
      .review-files { display: grid; gap: 6px; min-height: 0; max-height: 180px; overflow: auto; border: 1px solid var(--pi-border-muted); border-radius: 8px; padding: 8px; }
      .review-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: baseline; }
      .review-file span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dialog-error { border: 1px solid var(--pi-danger); border-radius: 8px; background: color-mix(in srgb, var(--pi-danger) 10%, transparent); color: var(--pi-danger); padding: 9px; line-height: 1.35; overflow-wrap: anywhere; }
      footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
    `,
  ];
}

export function workspaceUploadBatchesForScope(batches: Record<string, WorkspaceUploadBatchState>, scope: WorkspaceUploadScope): WorkspaceUploadBatchState[] {
  return Object.values(batches)
    .filter((batch) => batch.projectId === scope.projectId && batch.workspaceId === scope.workspaceId && batch.machineId === scope.machineId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function workspaceUploadReviewError(files: readonly File[], destinationFolder: string): string | undefined {
  if (files.length === 0) return t("ui.workspaceFilesPanel.selectAtLeastOneFileToUpload", "Select at least one file to upload.");
  for (const file of files) {
    try {
      workspaceUploadPath(destinationFolder, file.name);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return undefined;
}

export function workspaceUploadReviewDefaults(destinationFolder: string): { destinationFolder: string; createDirs: boolean; overwrite: boolean } {
  return { destinationFolder, createDirs: true, overwrite: false };
}

/**
 * The muted status message the file viewer shows instead of file content, or
 * `undefined` when a real image/code viewer renders. Pure seam so tests can
 * assert viewer messaging (empty/loading/binary) without scraping Lit markup.
 */
export function workspaceFileViewerStatusLabel(
  context: Pick<WorkspacePanelContext, "selectedFilePath" | "selectedFileContent">,
): string | undefined {
  const file = context.selectedFileContent;
  if (context.selectedFilePath === undefined || context.selectedFilePath === "") return t("ui.workspaceFilesPanel.selectAFile", "Select a file.");
  if (file === undefined) return t("ui.workspaceFilesPanel.loading", "Loading {selectedFilePath}…", { selectedFilePath: context.selectedFilePath });
  if (file.mediaType === "image") return undefined;
  if (file.binary) return t("ui.workspaceFilesPanel.binaryFile", "Binary file: {path} · {size}", { path: file.path, size: formatFileSize(file.size) });
  return undefined;
}

export function selectedWorkspacePathKind(
  fileTree: readonly FileTreeEntry[],
  expandedDirs: Record<string, readonly FileTreeEntry[]>,
  selectedPath: string | undefined,
): FileTreeEntry["type"] | undefined {
  if (selectedPath === undefined) return undefined;
  return findWorkspaceTreeEntry(fileTree, expandedDirs, selectedPath)?.type;
}

export function workspaceNewPathDefault(selectedPath: string | undefined, selectedKind: FileTreeEntry["type"] | undefined, basename: string): string {
  if (selectedPath === undefined || selectedPath === "") return basename;
  if (selectedKind === "directory") return joinWorkspacePath(selectedPath, basename);
  const parent = workspaceParentPath(selectedPath);
  return parent === "" ? basename : joinWorkspacePath(parent, basename);
}

export function startDirectWorkspaceUpload(
  context: Pick<WorkspacePanelContext, "workspaceUploadDefaultFolder" | "onStartWorkspaceUpload">,
  files: readonly File[],
): ReturnType<WorkspacePanelContext["onStartWorkspaceUpload"]> {
  if (files.length === 0) return undefined;
  return context.onStartWorkspaceUpload(files, {
    destinationFolder: context.workspaceUploadDefaultFolder,
    createDirs: true,
    overwrite: false,
    selectUploadedFile: true,
  });
}

function workspaceContextKey(context: WorkspacePanelContext): string {
  return `${context.machine.id}:${context.workspace.projectId}:${context.workspace.id}`;
}

function promptWorkspacePath(message: string, defaultPath: string): string | undefined {
  const path = window.prompt(message, defaultPath);
  if (path === null) return undefined;
  const trimmed = path.trim();
  return trimmed === "" ? undefined : trimmed;
}

function findWorkspaceTreeEntry(fileTree: readonly FileTreeEntry[], expandedDirs: Record<string, readonly FileTreeEntry[]>, path: string): FileTreeEntry | undefined {
  const rootMatch = fileTree.find((entry) => entry.path === path);
  if (rootMatch !== undefined) return rootMatch;
  for (const entries of Object.values(expandedDirs)) {
    const match = entries.find((entry) => entry.path === path);
    if (match !== undefined) return match;
  }
  return undefined;
}

function workspaceParentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function joinWorkspacePath(parent: string, basename: string): string {
  return parent === "" ? basename : `${parent.replace(/\/+$/u, "")}/${basename.replace(/^\/+/u, "")}`;
}

function fileListToArray(files: FileList | null | undefined): File[] {
  return files === null || files === undefined ? [] : Array.from(files);
}

function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function uploadSummaryLabel(batches: readonly WorkspaceUploadBatchState[]): string {
  const uploading = batches.filter((batch) => batch.status === "uploading").length;
  return uploading === 0 ? t("ui.workspaceFilesPanel.recentUploads", "{length} recent uploads", { length: String(batches.length) }) : t("ui.workspaceFilesPanel.uploadsInProgress", "{uploading} uploads in progress", { uploading: String(uploading) });
}

function uploadBatchTitle(batch: WorkspaceUploadBatchState): string {
  const count = batch.files.length;
  switch (batch.status) {
    case "completed": return t("ui.workspaceFilesPanel.uploadedFiles", "Uploaded {count} files", { count: String(count) });
    case "error": return t("ui.workspaceFilesPanel.filesFailedToUpload", "{count} files failed to upload", { count: String(count) });
    case "cancelled": return t("ui.workspaceFilesPanel.cancelledUploadOfFiles", "Cancelled upload of {count} files", { count: String(count) });
    case "uploading": return t("ui.workspaceFilesPanel.uploadingFiles", "Uploading {count} files", { count: String(count) });
  }
}

export function uploadBatchStatusLabel(batch: WorkspaceUploadBatchState): string {
  switch (batch.status) {
    case "completed": return t("ui.workspaceFilesPanel.done", "Done");
    case "error": return t("ui.workspaceFilesPanel.failed", "Failed");
    case "cancelled": return t("ui.workspaceFilesPanel.cancelled", "Cancelled");
    case "uploading": return formatPercent(batch.percent);
  }
}

export function uploadBatchProgressValue(batch: WorkspaceUploadBatchState): number {
  return batch.status === "uploading" ? batch.percent : 1;
}

function uploadFileStatusLabel(file: WorkspaceUploadFileState): string {
  switch (file.status) {
    case "pending": return t("ui.workspaceFilesPanel.pending", "Pending");
    case "uploading": return formatPercent(file.percent);
    case "completed": return t("ui.workspaceFilesPanel.done", "Done");
    case "error": return t("ui.workspaceFilesPanel.error", "Error");
    case "cancelled": return t("ui.workspaceFilesPanel.cancelled", "Cancelled");
  }
}

function uploadFileDetail(file: WorkspaceUploadFileState): string {
  if (file.error !== undefined) return file.error;
  if (file.response !== undefined) return t("ui.workspaceFilesPanel.writtenTo", "Written to {path}", { path: file.response.path });
  return `${file.path} · ${formatFileSize(file.loaded)} / ${formatFileSize(file.total)}`;
}

function formatPercent(value: number): string {
  return `${String(Math.round(Math.max(0, Math.min(1, value)) * 100))}%`;
}

function loadCodeViewer(): void {
  void import("./CodeViewer");
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${String(size)} B`;
  const kib = size / 1024;
  if (kib < 1024) return `${formatScaledFileSize(kib)} KB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${formatScaledFileSize(mib)} MB`;
  return `${formatScaledFileSize(mib / 1024)} GB`;
}

function formatScaledFileSize(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

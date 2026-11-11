import type { FileIconsCapability, StylesheetIntegrationCapabilityV1, FilePreviewingCapability, FileTreeEntry, WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";
import type { UiPresentationCapabilityV1, UiPresentationActionV1 } from "@chainingintention/pi-web-cn/plugin-api";
import { t } from "./i18n.js";
import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { property, query, state } from "lit/decorators.js";
import {
  FilesRuntime,
  type FilesScopeState,
  type WorkspaceUploadBatchState,
  type WorkspaceUploadFileState,
  type WorkspaceUploadRun,
  workspaceFilesCapabilityV1,
  workspaceUploadPath,
} from "./FilesRuntime";
import { FilesLocalizationController, formatFileSize, formatPercent, type FilesContent } from "./filesLocalization";
import type { WorkspaceFilePreviewUrlBuilder } from "./FilesViewer";
import type { FilesViewerLoader } from "./viewerLoader";
import { createWorkspaceFileViewModeStore, type WorkspaceFileViewModeStore } from "./workspaceFileViewMode";
import type { ManagedAgentsMenu } from "./ManagedAgentsMenu";
import "./ManagedAgentsMenu";

interface PendingWorkspaceUploadReview {
  files: File[];
}

export class WorkspaceFilesPanel extends LitElement {
  @property({ attribute: false }) presentation: UiPresentationCapabilityV1 | undefined;
  private releasePresentation: (() => void) | undefined;
  private toolbarGeneration = 0;

  private subscribePresentation(): void {
    this.releasePresentation?.();
    this.releasePresentation = this.presentation?.subscribe?.(() => { this.toolbarGeneration++; this.requestUpdate(); });
  }

  protected override performUpdate(): void {
    try { super.performUpdate(); }
    catch (error) {
      if (this.presentation?.fail?.("files-toolbar", error) !== true) throw error;
      this.requestUpdate();
    }
  }
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
    if (this.isConnected && this.renderRoot instanceof ShadowRoot) this.releaseStyles = value?.registerRoot(this.renderRoot, { sharedUi: true });
  }

  private icons: FileIconsCapability | undefined;
  private releaseIcons: (() => void) | undefined;

  @property({ attribute: false })
  get fileIcons(): FileIconsCapability | undefined { return this.icons; }
  set fileIcons(value: FileIconsCapability | undefined) {
    if (value === this.icons) return;
    this.releaseIcons?.();
    this.releaseIcons = undefined;
    this.icons = value;
    if (this.isConnected) this.subscribeIcons();
  }

  private subscribeIcons(): void {
    this.releaseIcons ??= this.icons?.subscribe(() => { this.requestUpdate(); });
  }

  @property({ attribute: false }) context: WorkspacePanelContext | undefined;
  @property({ attribute: false }) runtime: FilesRuntime | undefined;
  @property({ attribute: false }) filePreviewing: FilePreviewingCapability | undefined;
  @property({ attribute: false }) loadViewerDependencies: FilesViewerLoader | undefined;
  @query("#workspace-upload-input") private uploadInput?: HTMLInputElement;
  @query("dialog.upload-dialog") private uploadDialog?: HTMLDialogElement;
  @state() private pendingUpload: PendingWorkspaceUploadReview | undefined;
  @state() private destinationFolder = "";
  @state() private overwrite = false;
  @state() private createDirs = true;
  @state() private formError: (() => string) | undefined;
  @state() private dragActive = false;
  @state() private visibleRows = 200;
  private dragDepth = 0;
  private scope: FilesScopeState | undefined;
  private unsubscribeRuntime: (() => void) | undefined;
  private boundRuntime: FilesRuntime | undefined;
  private boundScopeKey: string | undefined;
  private boundContext: WorkspacePanelContext | undefined;
  private scrollRestorePending = true;
  private navigationModeKey = "";
  private modeStore: WorkspaceFileViewModeStore = createWorkspaceFileViewModeStore(undefined);
  private uploadReturnFocus: HTMLElement | undefined;
  private visibilityObserver: ResizeObserver | undefined;
  private treeObserver: IntersectionObserver | undefined;

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("presentation")) this.subscribePresentation();
    if (!changedProperties.has("context") && !changedProperties.has("runtime")) return;
    const nextKey = this.context === undefined ? undefined : workspaceContextKey(this.context);
    if (this.boundScopeKey !== undefined && nextKey !== this.boundScopeKey) {
      this.resetPendingUpload();
      this.visibleRows = 200;
    }
    this.bindRuntime(nextKey);
    const nextNavigationModeKey = workspaceNavigationModeKey(this.context);
    if (nextNavigationModeKey !== this.navigationModeKey) {
      this.navigationModeKey = nextNavigationModeKey;
      this.modeStore = createWorkspaceFileViewModeStore(this.context?.navigation);
    }
  }

  protected override updated(): void {
    this.openPendingDialog();
    this.treeObserver?.disconnect();
    const more = this.renderRoot.querySelector(".tree-more");
    if (more !== null && typeof IntersectionObserver !== "undefined") {
      this.treeObserver ??= new IntersectionObserver((entries) => {
        if (this.isConnected && entries.some((entry) => entry.isIntersecting)) this.visibleRows += 200;
      }, { root: this.renderRoot.querySelector(".list") });
      this.treeObserver.observe(more);
    }
    this.restoreExplorerPresentation();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.subscribePresentation();
    this.subscribeIcons();
    if (this.renderRoot instanceof ShadowRoot) this.releaseStyles ??= this.integration?.registerRoot(this.renderRoot, { sharedUi: true });
    window.addEventListener("resize", this.handleResponsiveVisibilityChange);
    if (typeof ResizeObserver !== "undefined") {
      this.visibilityObserver ??= new ResizeObserver(this.handleResponsiveVisibilityChange);
      this.visibilityObserver.observe(this);
    }
    if (!this.hasUpdated) return;
    const nextKey = this.context === undefined ? undefined : workspaceContextKey(this.context);
    this.bindRuntime(nextKey);
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.toolbarGeneration++;
    this.releasePresentation?.();
    this.releasePresentation = undefined;
    this.treeObserver?.disconnect();
    // Detached layout has already reset scrollTop in browsers. Scroll events own
    // the last visible position; do not replace it with detached geometry.
    this.scrollRestorePending = true;
    this.boundContext = undefined;
    window.removeEventListener("resize", this.handleResponsiveVisibilityChange);
    this.visibilityObserver?.disconnect();
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = undefined;
    this.boundRuntime = undefined;
    this.boundScopeKey = undefined;
    this.uploadReturnFocus = undefined;
    this.resetPendingUpload();
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    this.releaseIcons?.();
    this.releaseIcons = undefined;
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    const context = this.context;
    const runtime = this.runtime;
    const scope = this.scope;
    if (this.content === undefined) return html``;
    if (context === undefined || runtime === undefined || scope === undefined) return html`<p class="muted">${this.text.messages.t("unavailable")}</p>`;
    if (scope.capabilityError !== undefined) {
      return html`
        <section class="capability-error" role="alert">
          <strong>${this.text.messages.t("hostUnavailable")}</strong>
          <span>${scope.capabilityError}</span>
        </section>
      `;
    }
    const files = workspaceFilesCapabilityV1(context.files);
    if (files === undefined) return html`<p class="capability-error" role="alert">${this.text.messages.t("capabilityRequired")}</p>`;
    const previewUrlBuilder: WorkspaceFilePreviewUrlBuilder = (_projectId, _workspaceId, path, options) => {
      const reference = options?.modifiedAt === undefined ? undefined : { version: options.modifiedAt };
      return options?.download === true ? files.downloadUrl(path, reference) : files.previewUrl(path, reference);
    };
    const selectedPath = scope.selectedDirectoryPath ?? scope.selectedFilePath;
    const directory = scope.selectedDirectoryPath !== undefined;
    const rows = flattenTree(scope.fileTree, scope.expandedDirs);
    const selectedIndex = rows.findIndex(({ entry }) => entry.path === selectedPath);
    const rowLimit = Math.max(this.visibleRows, Math.ceil((selectedIndex + 1) / 200) * 200);
    return html`
      <section
        class=${this.dragActive ? "files-panel dragging" : "files-panel"}
        @dragenter=${this.handleDragEnter}
        @dragover=${this.handleDragOver}
        @dragleave=${this.handleDragLeave}
        @drop=${this.handleDrop}
      >
        <section class="toolbar ui-toolbar">
          <strong class="ui-toolbar-title">${t("ui.toolExecutionView.file", "File")}</strong>
          ${scope.treeLoading ? html`<span class="muted">${t("ui.main.300ee3dee4dc", "loading…")}</span>` : null}
          ${scope.treeStale ? html`<span class="stale">${t("ui.workspaceGitPanel.stale", "Stale")}</span>` : null}
          <div class="toolbar-actions ui-toolbar-group">
            ${this.renderToolbar(context, runtime, scope)}
            ${files.managedAgents === undefined ? nothing : html`<pi-web-managed-agents-menu .control=${files.managedAgents} .scopeKey=${workspaceContextKey(context)} .stylesheetIntegration=${this.stylesheetIntegration} @agents-applied=${() => { void runtime.refreshFiles(context); }}></pi-web-managed-agents-menu>`}
          </div>
          <input id="workspace-upload-input" class="visually-hidden" type="file" multiple hidden @change=${this.handleFileInputChange} />
        </section>
        ${scope.error === undefined ? null : html`<p class="files-error" role="alert">${scope.error}</p>`}
        ${this.renderUploadProgress(context, runtime, scope)}
        <section class="split">
          <div class="list tree ui-file-list" @scroll=${this.handleTreeScroll}>
            ${rows.length === 0 ? html`<p class="muted">${t("ui.workspaceFilesPanel.noFilesLoaded", "No files loaded.")}</p>` : rows.slice(0, rowLimit).map(({entry, depth}) => this.renderTreeEntry(context, runtime, scope, entry, depth))}
            ${rows.length > rowLimit ? html`<button class="tree-more" @click=${() => { this.visibleRows = rowLimit + 200; }}>${t("ui.main.a2205b3878a2", "Show more")}</button>` : null}
          </div>
          <div class="viewer">
            ${directory ? html`<p class="muted">${t("ui.main.2142df04ff19", "Selected folder: ")}${selectedPath}</p>` : html`
            <pi-web-files-viewer
              .content=${this.content}
              .stylesheetIntegration=${this.stylesheetIntegration}
              .filePreviewing=${this.filePreviewing}
              .loadViewerDependencies=${this.loadViewerDependencies}
              .files=${context.files}
              .machineId=${context.machine.id}
              .projectId=${context.workspace.projectId}
              .workspaceId=${context.workspace.id}
              .selectedPath=${scope.selectedFilePath}
              .file=${scope.selectedFileContent}
              .loadError=${scope.selectedFileLoadError}
              .previewUrlBuilder=${previewUrlBuilder}
              .modeStore=${this.modeStore}
              .maxInlinePreviewBytes=${files.maxInlinePreviewBytes}
            ></pi-web-files-viewer>
            `}
          </div>
        </section>
        <div class="drop-overlay" aria-hidden=${this.dragActive ? "false" : "true"}>
          <div>
            <strong>${this.text.messages.t("drop")}</strong>
            <span>${this.text.messages.t("dropHelp")}</span>
          </div>
        </div>
        ${this.pendingUpload === undefined ? null : this.renderUploadDialog(context, runtime, this.pendingUpload, files.defaultUploadFolder)}
      </section>
    `;
  }

  private bindRuntime(nextKey: string | undefined): void {
    const context = this.context;
    const runtime = this.runtime;
    const needsSubscription = runtime !== this.boundRuntime || nextKey !== this.boundScopeKey;
    if (needsSubscription) {
      // Save the old scope before Lit reuses its list element for another workspace.
      this.rememberExplorerScroll();
      this.scrollRestorePending = true;
      this.unsubscribeRuntime?.();
      this.unsubscribeRuntime = undefined;
      this.boundRuntime = runtime;
      this.boundScopeKey = nextKey;
    }
    if (context === undefined || runtime === undefined) {
      this.scope = undefined;
      return;
    }
    if (needsSubscription) {
      this.unsubscribeRuntime = runtime.subscribe(context, (snapshot, latestContext) => {
        if (this.runtime !== this.boundRuntime || workspaceContextKey(latestContext) !== this.boundScopeKey) return;
        this.context = latestContext;
        this.scope = snapshot;
        this.requestUpdate();
      });
    }
    this.boundContext = context;
    this.scope = runtime.prepare(context);
  }

  private createPath(context: WorkspacePanelContext, runtime: FilesRuntime, scope: FilesScopeState, directory: boolean): void {
    const selected = scope.selectedDirectoryPath ?? scope.selectedFilePath ?? "";
    const folder = scope.selectedDirectoryPath ?? selected.slice(0, Math.max(0, selected.lastIndexOf("/")));
    const name = directory ? "new-folder" : "new-file.txt";
    const path = window.prompt(directory ? t("ui.workspaceFilesPanel.newFolderPath", "New folder path") : t("ui.workspaceFilesPanel.newFilePath", "New file path"), folder ? `${folder}/${name}` : name);
    if (path === null || path.trim() === "") return;
    if (directory) void runtime.createDirectory(context, path.trim());
    else void runtime.createFile(context, path.trim());
  }

  private renderToolbar(context: WorkspacePanelContext, runtime: FilesRuntime, scope: FilesScopeState): TemplateResult {
    const refresh = () => { void runtime.refreshFiles(context); void this.renderRoot.querySelector<ManagedAgentsMenu>("pi-web-managed-agents-menu")?.refresh(); };
    const fallback = html`<button class="ui-button" @click=${this.openFilePicker}>${t("ui.workspaceFilesPanel.upload", "Upload")}</button><button class="ui-button" @click=${refresh}>${t("bundled.relays.refresh.aee887", "Refresh")}</button>`;
    const files = workspaceFilesCapabilityV1(context.files);
    if (files === undefined || this.presentation?.render === undefined) return fallback;
    const path = scope.selectedDirectoryPath ?? scope.selectedFilePath;
    const directory = scope.selectedDirectoryPath !== undefined;
    const selected = path !== undefined && path !== "";
    const busy = scope.mutating === true;
    const generation = ++this.toolbarGeneration;
    const actions: UiPresentationActionV1[] = [
      { id: "new-file", label: t("ui.workspaceFilesPanel.newFile", "New file"), disabled: busy, run: () => { this.createPath(context, runtime, scope, false); } },
      { id: "new-folder", label: t("ui.workspaceFilesPanel.newFolder", "New folder"), disabled: busy || files.createDirectory === undefined, run: () => { this.createPath(context, runtime, scope, true); } },
      { id: "upload", label: t("ui.workspaceFilesPanel.uploadFiles", "Upload files"), run: () => { this.uploadReturnFocus = this.shadowRoot?.activeElement instanceof HTMLElement ? this.shadowRoot.activeElement : undefined; this.uploadInput?.click(); } },
      ...(selected && !directory ? [{ id: "download", label: t("ui.workspaceFilesPanel.downloadFile", "Download file"), run: () => { const anchor = document.createElement("a"); anchor.href = files.downloadUrl(path); anchor.download = ""; anchor.click(); } }] : []),
      { id: "rename", label: t("ui.workspaceFilesPanel.moveOrRename2", "Move or rename"), disabled: busy || !selected || (directory && files.moveDirectory === undefined), run: () => {
        const next = window.prompt(directory ? t("ui.workspaceFilesPanel.moveOrRenameFolderTo", "Move or rename folder to") : t("ui.workspaceFilesPanel.moveOrRenameFileTo", "Move or rename file to"), path);
        if (next !== null && next.trim() !== "") void runtime.moveSelectedPath(context, next.trim());
      } },
      { id: "delete", label: t("ui.workspaceFilesPanel.deleteFileOrFolder", "Delete file or folder"), disabled: busy || !selected || (directory && files.deleteDirectory === undefined), run: () => {
        if (window.confirm(t("ui.workspaceFilesPanel.deleteThisCannotBeUndone", "Delete {kind} {current}? This cannot be undone.", { kind: directory ? t("ui.workspaceFilesPanel.emptyFolder", "empty folder") : t("ui.toolExecutionView.file", "File"), current: path ?? "" }))) void runtime.deleteSelectedPath(context);
      } },
      { id: "refresh", label: t("bundled.relays.refresh.aee887", "Refresh"), run: refresh },
    ];
    const guarded = actions.map((action) => Object.freeze({ ...action, run: () => {
      if (this.isConnected && this.context === context && this.runtime === runtime && generation === this.toolbarGeneration && action.disabled !== true) return action.run();
    } }));
    return this.presentation.render(Object.freeze({ region: "files-toolbar", mode: files.managedAgents === undefined ? "normal" : "management", machine: Object.freeze({ id: context.machine.id, name: context.machine.name }), slots: Object.freeze([]), actions: Object.freeze(guarded) })) ?? fallback;
  }

  private rememberExplorerScroll(): void {
    const list = this.renderRoot.querySelector<HTMLElement>(".list.tree");
    if (!this.isConnected || !this.isPanelVisible() || this.scrollRestorePending || list === null || this.boundContext === undefined) return;
    this.boundRuntime?.rememberScroll(this.boundContext, list.scrollTop);
  }

  private readonly handleTreeScroll = (): void => {
    // Ignore clamping and programmatic scroll events until the new tree is ready.
    if (this.context === undefined || workspaceContextKey(this.context) !== this.boundScopeKey) return;
    this.rememberExplorerScroll();
  };

  private restoreExplorerPresentation(): void {
    const scope = this.scope;
    const context = this.boundContext;
    const runtime = this.boundRuntime;
    const list = this.renderRoot.querySelector<HTMLElement>(".list.tree");
    if (!this.isConnected || scope === undefined || scope.treeLoading || context === undefined || runtime === undefined || list === null || !this.isPanelVisible()) return;
    const reveal = scope.revealRequest;
    if (reveal !== undefined) {
      // Compare paths directly: filenames need not be valid CSS selector fragments.
      const row = [...list.querySelectorAll<HTMLButtonElement>(".row")].find((candidate) => candidate.title === reveal.path);
      if (row === undefined) return;
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
      this.scrollRestorePending = false;
      runtime.acknowledgeReveal(context, reveal.id, list.scrollTop);
    } else if (this.scrollRestorePending) {
      list.scrollTop = scope.scrollTop;
      this.scrollRestorePending = false;
    }
  }

  private renderTreeEntry(
    context: WorkspacePanelContext,
    runtime: FilesRuntime,
    scope: FilesScopeState,
    entry: FileTreeEntry,
    depth: number,
  ): TemplateResult {
    const expanded = scope.expandedPaths.includes(entry.path);
    const selected = (scope.selectedDirectoryPath ?? scope.selectedFilePath) === entry.path;
    return html`
      <button type="button" class=${selected ? "row ui-button ui-file-row selected" : "row ui-button ui-file-row"} style=${`--depth:${String(depth)}`} title=${entry.path} aria-current=${selected ? "page" : nothing} aria-expanded=${entry.type === "directory" ? String(expanded) : nothing} @click=${() => {
        if (entry.type === "directory") {
          runtime.selectDirectory(context, entry.path);
          void runtime.expandDir(context, entry.path);
        }
        else void runtime.selectFile(context, entry.path);
      }}>
        <span class="ui-file-leading" aria-hidden="true">${entry.type === "directory" ? (expanded ? "▾" : "▸") : html`<pi-web-files-icon .url=${this.icons?.resolveIcon(entry.path)}></pi-web-files-icon>`}</span>
        <span class="ui-file-label" dir="ltr">${entry.name}</span>
      </button>
    `;
  }

  private renderUploadProgress(context: WorkspacePanelContext, runtime: FilesRuntime, scope: FilesScopeState): TemplateResult | null {
    const batches = workspaceUploadBatches(scope.uploadBatches);
    if (batches.length === 0) return null;
    return html`
      <section class="upload-progress" aria-label=${this.text.messages.t("uploadsRegion")}>
        <div class="upload-progress-header">
          <strong>${this.text.messages.t("uploads")}</strong>
          <small>${uploadSummaryLabel(batches, this.requireContent())}</small>
        </div>
        ${batches.map((batch) => html`
          <article class=${`upload-batch ${batch.status}`}>
            <div class="upload-batch-heading">
              <div>
                <strong>${uploadBatchTitle(batch, this.requireContent())}</strong>
                <small>${batch.destinationFolder === "" ? this.text.messages.t("root") : html`<bdi dir="ltr">${batch.destinationFolder}</bdi>`}</small>
              </div>
              <span>${uploadBatchStatusLabel(batch, this.requireContent())}</span>
            </div>
            <progress max="1" .value=${uploadBatchProgressValue(batch)}></progress>
            <div class="upload-file-list">${batch.files.map((file) => this.renderUploadFile(file))}</div>
            <div class="upload-actions">
              ${batch.status === "uploading"
                ? html`<button @click=${() => { runtime.cancelWorkspaceUpload(context, batch.id); }}>${this.text.messages.t("cancel")}</button>`
                : html`<button @click=${() => { runtime.clearWorkspaceUpload(context, batch.id); }}>${this.text.messages.t("dismiss")}</button>`}
            </div>
          </article>
        `)}
      </section>
    `;
  }

  private renderUploadFile(file: WorkspaceUploadFileState): TemplateResult {
    return html`
      <div class=${`upload-file ${file.status}`}>
        <div class="upload-file-main">
          <bdi dir="ltr">${file.name}</bdi>
          <small>${uploadFileDetail(file, this.requireContent())}</small>
        </div>
        <span class="upload-file-status">${uploadFileStatusLabel(file, this.requireContent())}</span>
      </div>
    `;
  }

  private renderUploadDialog(
    context: WorkspacePanelContext,
    runtime: FilesRuntime,
    review: PendingWorkspaceUploadReview,
    defaultFolder: string,
  ): TemplateResult {
    const fileCount = review.files.length;
    return html`
      <dialog class="upload-dialog" aria-label=${this.text.messages.t("reviewLabel")} @cancel=${this.handleDialogCancel} @close=${this.handleDialogClose} @click=${this.handleDialogClick}>
        <header>
          <div>
            <span class="eyebrow">${this.text.messages.t("upload")}</span>
            <h2>${this.text.messages.t("review", { count: fileCount })}</h2>
          </div>
          <button class="close-button" type="button" title=${this.text.messages.t("cancelUpload")} aria-label=${this.text.messages.t("cancelUpload")} @click=${() => { this.closeUploadDialog(); }}>×</button>
        </header>
        <form @submit=${(event: SubmitEvent) => { this.submitUploadReview(event, context, runtime, review); }}>
          <label>
            <span>${this.text.messages.t("destination")}</span>
            <input id="workspace-upload-destination" dir="ltr" autofocus .value=${this.destinationFolder} placeholder=${defaultFolder} @input=${this.handleDestinationInput} />
            <small>${this.text.messages.t("destinationHelp")}</small>
          </label>
          <div class="dialog-options">
            <label><input type="checkbox" .checked=${this.createDirs} @change=${this.handleCreateDirsChange} /><span>${this.text.messages.t("createDirs")}</span></label>
            <label><input type="checkbox" .checked=${this.overwrite} @change=${this.handleOverwriteChange} /><span>${this.text.messages.t("overwrite")}</span></label>
          </div>
          <section class="review-files" aria-label=${this.text.messages.t("toUpload")}>
            <strong>${this.text.messages.t("fileHeading", { count: fileCount })}</strong>
            ${review.files.map((file) => html`<div class="review-file"><bdi dir="ltr">${file.name}</bdi><small>${formatFileSize(file.size, this.requireContent())}</small></div>`)}
          </section>
          ${this.formError === undefined ? null : html`<div class="dialog-error" role="alert">${this.formError()}</div>`}
          <footer>
            <button type="button" @click=${() => { this.closeUploadDialog(); }}>${this.text.messages.t("cancel")}</button>
            <button type="submit">${this.text.messages.t("upload")}</button>
          </footer>
        </form>
      </dialog>
    `;
  }

  private readonly openFilePicker = (event: Event): void => {
    if (event.currentTarget instanceof HTMLElement) this.uploadReturnFocus = event.currentTarget;
    this.uploadInput?.click();
  };

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
    if (this.context !== undefined && this.runtime !== undefined) startDirectWorkspaceUpload(this.runtime, this.context, files);
  };

  private readonly handleDestinationInput = (event: Event): void => {
    this.destinationFolder = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : "";
    this.formError = undefined;
  };

  private readonly handleCreateDirsChange = (event: Event): void => {
    this.createDirs = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.checked : true;
  };

  private readonly handleOverwriteChange = (event: Event): void => {
    this.overwrite = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.checked : false;
  };

  private readonly handleDialogCancel = (event: Event): void => {
    event.preventDefault();
    this.closeUploadDialog();
  };

  private readonly handleDialogClose = (): void => {
    if (this.pendingUpload !== undefined) {
      this.pendingUpload = undefined;
      this.formError = undefined;
    }
    this.restoreUploadFocus();
  };

  private readonly handleDialogClick = (event: MouseEvent): void => {
    if (event.target === this.uploadDialog) this.closeUploadDialog();
  };

  private readonly handleResponsiveVisibilityChange = (): void => {
    // Visibility can change without a Lit update (the responsive shell hides us).
    if (this.isPanelVisible()) {
      void this.updateComplete.then(() => { this.restoreExplorerPresentation(); });
    }
    const dialog = this.uploadDialog;
    if ((this.pendingUpload === undefined && dialog?.open !== true) || this.isPanelVisible()) return;
    // The trigger remains connected when the compact shell CSS hides this
    // panel, but focusing that hidden control would create a second trap.
    this.uploadReturnFocus = undefined;
    this.resetPendingUpload();
  };

  private openUploadReview(files: File[]): void {
    const defaultFolder = this.context === undefined ? "" : workspaceFilesCapabilityV1(this.context.files)?.defaultUploadFolder ?? "";
    const defaults = workspaceUploadReviewDefaults(defaultFolder);
    this.pendingUpload = { files };
    this.destinationFolder = defaults.destinationFolder;
    this.overwrite = defaults.overwrite;
    this.createDirs = defaults.createDirs;
    this.formError = undefined;
  }

  private submitUploadReview(event: SubmitEvent, context: WorkspacePanelContext, runtime: FilesRuntime, review: PendingWorkspaceUploadReview): void {
    event.preventDefault();
    const validationError = workspaceUploadReviewError(review.files, this.destinationFolder, this.content, runtime);
    if (validationError !== undefined) {
      const folder = this.destinationFolder;
      this.formError = () => workspaceUploadReviewError(review.files, folder, this.content, runtime) ?? validationError;
      return;
    }
    const run = runtime.startWorkspaceUpload(context, review.files, {
      destinationFolder: this.destinationFolder,
      createDirs: this.createDirs,
      overwrite: this.overwrite,
      selectUploadedFile: true,
    });
    if (run !== undefined) this.closeUploadDialog();
  }

  private openPendingDialog(): void {
    const dialog = this.uploadDialog;
    if (this.pendingUpload === undefined || dialog === undefined || dialog.open) return;
    // A native chooser can finish after responsive layout has hidden this
    // still-connected panel. Recheck at the showModal boundary so it cannot
    // create an invisible modal that leaves the rest of the application inert.
    if (!this.isPanelVisible()) {
      this.uploadReturnFocus = undefined;
      const hiddenReview = this.pendingUpload;
      queueMicrotask(() => {
        if (this.pendingUpload === hiddenReview) this.resetPendingUpload();
      });
      return;
    }
    try {
      dialog.showModal();
      this.renderRoot.querySelector<HTMLInputElement>("#workspace-upload-destination")?.focus();
    } catch (error) {
      const diagnostic = errorMessage(error);
      this.formError = () => this.text.messages.t("reviewFailed", { error: diagnostic });
    }
  }

  private isPanelVisible(): boolean {
    return this.getClientRects().length > 0;
  }

  private closeUploadDialog(): void {
    const dialog = this.uploadDialog;
    if (dialog?.open === true) dialog.close();
    else {
      this.pendingUpload = undefined;
      this.formError = undefined;
      this.restoreUploadFocus();
    }
  }

  private restoreUploadFocus(): void {
    const target = this.uploadReturnFocus;
    this.uploadReturnFocus = undefined;
    void this.updateComplete.then(() => { if (target?.isConnected === true) target.focus(); });
  }

  private resetPendingUpload(): void {
    if (this.uploadDialog?.open === true) this.uploadDialog.close();
    this.pendingUpload = undefined;
    this.formError = undefined;
    this.dragDepth = 0;
    this.dragActive = false;
  }

  private requireContent(): FilesContent {
    if (this.content === undefined) throw new Error("Files localization is unavailable");
    return this.content;
  }

  static override styles = css`
    @layer pi-web-base {
    :host { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; color: var(--pi-text); background: var(--pi-bg); font: 13px var(--pi-font, system-ui, sans-serif); container-type: inline-size; }
    .files-panel { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .toolbar { gap: 8px; padding-inline-start: 10px; }
    .toolbar .ui-toolbar-title { flex: 0 0 auto; font-weight: 500; }
    .toolbar > .muted, .toolbar > .stale { align-self: center; }
    .toolbar-actions { margin-inline-start: auto; }
    /* Host UI classes own their controls, including file-row grid geometry. */
    button:not(.ui-button) { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--pi-border); border-radius: 7px; background: var(--pi-surface); color: var(--pi-text); padding: 5px 7px; cursor: pointer; }
    button:not(.ui-button):focus-visible, input:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    .muted { color: var(--pi-muted); }
    .stale { border: 1px solid var(--pi-warning-border); border-radius: 999px; color: var(--pi-warning); padding: 1px 6px; font-size: 12px; }
    .files-error { flex: 0 0 auto; margin: 0; border-bottom: 1px solid var(--pi-danger); color: var(--pi-danger); padding: 8px; overflow-wrap: anywhere; }
    .capability-error { box-sizing: border-box; width: min(100%, 420px); margin: auto; display: grid; gap: 8px; color: var(--pi-danger); padding: 24px; text-align: center; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
    .split { flex: 1 1 auto; min-height: 0; display: grid; grid-template-rows: minmax(160px, 34%) minmax(0, 1fr); }
    .list { border-bottom: 1px solid var(--pi-border); }
    .viewer { min-height: 0; overflow: auto; display: flex; flex-direction: column; }
    pi-web-files-viewer { flex: 1 1 auto; min-height: 0; }
    p { margin: 10px; }
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
    .upload-file-list { display: grid; gap: 4px; max-height: 180px; overflow: auto; padding-inline-end: 2px; }
    .upload-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; color: var(--pi-muted); }
    .upload-file.completed .upload-file-status { color: var(--pi-success); }
    .upload-file.error { color: var(--pi-danger); }
    .upload-file.cancelled .upload-file-status { color: var(--pi-warning); }
    .upload-file-main { min-width: 0; display: grid; gap: 1px; }
    .upload-file-main bdi, .upload-file-main small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .upload-file-status { font-size: 12px; white-space: nowrap; }
    .upload-actions { justify-content: end; }
    dialog.upload-dialog { box-sizing: border-box; width: min(560px, calc(100% - 40px)); max-height: min(720px, calc(100% - 40px)); max-height: min(720px, calc(100dvh - 40px)); margin: auto; padding: 0; border: 1px solid var(--pi-border); border-radius: 14px; background: var(--pi-bg); color: var(--pi-text); box-shadow: 0 18px 70px var(--pi-shadow-strong); overflow: hidden; }
    dialog.upload-dialog[open] { display: flex; flex-direction: column; }
    dialog.upload-dialog::backdrop { background: var(--pi-overlay); }
    .upload-dialog header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--pi-border-muted); }
    .upload-dialog h2 { margin: 2px 0 0; font-size: 18px; line-height: 1.2; }
    .eyebrow { color: var(--pi-muted); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    .close-button { font-size: 20px; line-height: 1; padding: 4px 9px; }
    form { box-sizing: border-box; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 12px; overflow: auto; overscroll-behavior: contain; padding: 16px; }
    form > label { flex: 0 0 auto; display: grid; gap: 6px; }
    form > label > span, .review-files > strong { font-weight: 600; }
    form > label > input:not([type]) { box-sizing: border-box; width: 100%; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 8px 9px; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, var(--pi-font, system-ui, sans-serif)); }
    .dialog-options { flex: 0 0 auto; display: grid; gap: 8px; }
    .dialog-options label { display: flex; align-items: center; gap: 8px; }
    .review-files { flex: 1 1 180px; display: grid; gap: 6px; min-height: 0; max-height: 180px; overflow: auto; border: 1px solid var(--pi-border-muted); border-radius: 8px; padding: 8px; }
    .review-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: baseline; }
    .review-file bdi { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dialog-error { flex: 0 0 auto; border: 1px solid var(--pi-danger); border-radius: 8px; background: color-mix(in srgb, var(--pi-danger) 10%, transparent); color: var(--pi-danger); padding: 9px; overflow-wrap: anywhere; }
    footer { flex: 0 0 auto; display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }

    }
  `;
}

export function workspaceUploadBatches(batches: Record<string, WorkspaceUploadBatchState>): WorkspaceUploadBatchState[] {
  return Object.values(batches).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function flattenTree(entries: readonly FileTreeEntry[], expanded: Record<string, FileTreeEntry[]>, depth = 0): { entry: FileTreeEntry; depth: number }[] {
  return entries.flatMap((entry) => [{ entry, depth }, ...flattenTree(expanded[entry.path] ?? [], expanded, depth + 1)]);
}

export function workspaceUploadReviewError(files: readonly File[], destinationFolder: string, content?: FilesContent, runtime?: FilesRuntime): string | undefined {
  if (files.length === 0) return content?.messages.t("chooseFile") ?? "Choose at least one file to upload.";
  for (const file of files) {
    try {
      workspaceUploadPath(destinationFolder, file.name);
    } catch (error) {
      return runtime?.formatError(error) ?? errorMessage(error);
    }
  }
  return undefined;
}

export function workspaceUploadReviewDefaults(destinationFolder: string): { destinationFolder: string; createDirs: boolean; overwrite: boolean } {
  return { destinationFolder, createDirs: true, overwrite: false };
}

export function startDirectWorkspaceUpload(
  runtime: FilesRuntime,
  context: WorkspacePanelContext,
  files: readonly File[],
): WorkspaceUploadRun | undefined {
  if (files.length === 0) return undefined;
  const capability = workspaceFilesCapabilityV1(context.files);
  if (capability === undefined) return undefined;
  return runtime.startWorkspaceUpload(context, files, {
    destinationFolder: capability.defaultUploadFolder,
    createDirs: true,
    overwrite: false,
    selectUploadedFile: true,
  });
}

export function uploadBatchStatusLabel(batch: WorkspaceUploadBatchState, content: FilesContent): string {
  switch (batch.status) {
    case "completed": return content.messages.t("done");
    case "error": return content.messages.t("failed");
    case "cancelled": return content.messages.t("cancelled");
    case "uploading": return formatPercent(batch.percent, content);
  }
}

export function uploadBatchProgressValue(batch: WorkspaceUploadBatchState): number {
  return batch.status === "uploading" ? batch.percent : 1;
}

function uploadSummaryLabel(batches: readonly WorkspaceUploadBatchState[], content: FilesContent): string {
  const uploading = batches.filter((batch) => batch.status === "uploading").length;
  return content.messages.t(uploading === 0 ? "recent" : "uploadingCount", { count: uploading === 0 ? batches.length : uploading });
}

function uploadBatchTitle(batch: WorkspaceUploadBatchState, content: FilesContent): string {
  return content.messages.t("batchTitle", { status: batch.status, count: batch.files.length });
}

function uploadFileStatusLabel(file: WorkspaceUploadFileState, content: FilesContent): string {
  switch (file.status) {
    case "pending": return content.messages.t("pending");
    case "uploading": return formatPercent(file.percent, content);
    case "completed": return content.messages.t("done");
    case "error": return content.messages.t("error");
    case "cancelled": return content.messages.t("cancelled");
  }
}

function uploadFileDetail(file: WorkspaceUploadFileState, content: FilesContent): string {
  if (file.error !== undefined) return file.error;
  if (file.response !== undefined) return content.messages.t("wrote", { path: file.response.path });
  return content.messages.t("fileProgress", { path: file.path, loaded: formatFileSize(file.loaded, content), total: formatFileSize(file.total, content) });
}

function workspaceContextKey(context: WorkspacePanelContext): string {
  return JSON.stringify([context.machine.id, context.workspace.projectId, context.workspace.id]);
}

function workspaceNavigationModeKey(context: WorkspacePanelContext | undefined): string {
  const value = context?.navigation?.query["mode"];
  const mode = typeof value === "string" ? value : value?.[0];
  return JSON.stringify([
    context?.machine.id ?? null,
    context?.workspace.projectId ?? null,
    context?.workspace.id ?? null,
    context?.navigation?.contributionId ?? null,
    mode ?? null,
  ]);
}

function fileListToArray(files: FileList | null | undefined): File[] {
  return files === null || files === undefined ? [] : Array.from(files);
}

function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { t } from "./i18n.js";
import type {
  FileContentResponse,
  FileTreeEntry,
  PluginLocalization,
  WorkspaceFileUploadTask,
  WorkspaceFilesCapabilityV1,
  WorkspaceFilesContextValue,
  WorkspaceInvalidation,
  WorkspacePanelContext as LegacyWorkspacePanelContext,
  WorkspacePanelNavigationV1,
  WriteWorkspaceFileResponse,
} from "@chainingintention/pi-web-cn/plugin-api";

import {
  createFilesRuntimeMessages,
  FilesRuntimeValidationError,
  formatFilesRuntimeDiagnostic,
  setFilesRuntimeDiagnostic,
  type FilesRuntimeDiagnostic,
} from "./filesRuntimeMessages";

import { createExplorerViewStateStore, type ExplorerViewStateStore } from "./explorerViewState";

const MAX_RECENT_SCOPES = 8;
type WorkspacePanelContext = Omit<LegacyWorkspacePanelContext, "backend">;

export type WorkspaceUploadFileStatus = "pending" | "uploading" | "completed" | "error" | "cancelled";
export type WorkspaceUploadBatchStatus = "uploading" | "completed" | "error" | "cancelled";

export interface WorkspaceUploadFileState {
  readonly index: number;
  readonly name: string;
  path: string;
  readonly size: number;
  loaded: number;
  total: number;
  percent: number;
  lengthComputable: boolean;
  status: WorkspaceUploadFileStatus;
  error?: string;
  response?: WriteWorkspaceFileResponse;
}

export interface WorkspaceUploadBatchState {
  readonly id: string;
  readonly destinationFolder: string;
  readonly overwrite: boolean;
  readonly createDirs: boolean;
  readonly files: WorkspaceUploadFileState[];
  currentFileIndex: number;
  loaded: number;
  total: number;
  percent: number;
  status: WorkspaceUploadBatchStatus;
  readonly startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface FilesScopeState {
  readonly key: string;
  readonly machineId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  fileTree: FileTreeEntry[];
  expandedDirs: Record<string, FileTreeEntry[]>;
  /** Expansion intent is independent of directory listings and survives interrupted loads. */
  expandedPaths: string[];
  scrollTop: number;
  revealRequest?: { id: number; path: string };
  treeLoading: boolean;
  treeStale: boolean;
  error?: string;
  selectedFilePath?: string;
  selectedDirectoryPath?: string;
  mutating?: boolean;
  selectedFileContent?: FileContentResponse;
  selectedFileLoadError?: string;
  uploadBatches: Record<string, WorkspaceUploadBatchState>;
  capabilityError?: string;
}

export interface StartWorkspaceUploadOptions {
  destinationFolder: string;
  createDirs?: boolean;
  overwrite?: boolean;
  selectUploadedFile?: boolean;
}

export interface WorkspaceUploadRun {
  batchId: string;
  done: Promise<void>;
}

type FilesScopeListener = (snapshot: FilesScopeState, context: WorkspacePanelContext) => void;

interface ScopeRecord extends FilesScopeState {
  context: WorkspacePanelContext;
  files: WorkspaceFilesCapabilityV1 | undefined;
  navigationSnapshot: WorkspacePanelNavigationV1 | undefined;
  pendingReveal: { id: number; path: string } | undefined;
  listeners: Set<FilesScopeListener>;
  selectedRequestGeneration: number;
  selectedAbort: AbortController | undefined;
  selectedNeedsRestore: boolean;
  treeRequestGeneration: number;
  treeAbort: AbortController | undefined;
  treeRefresh: Promise<void> | undefined;
  expandedAborts: Map<string, AbortController>;
  initialized: boolean;
  suspended: boolean;
  lastUsed: number;
  uploadTasks: Map<string, WorkspaceFileUploadTask>;
  cancelledUploads: Set<string>;
}

export interface FilesRuntimeDependencies {
  createUploadBatchId?: () => string;
  now?: () => string;
  explorerViewState?: ExplorerViewStateStore;
}

/**
 * Plugin-owned Files state, bounded by recent workspace scope. Host callbacks
 * provide authority and transport; this runtime owns only product state and
 * orchestration.
 */
export class FilesRuntime {
  private readonly scopes = new Map<string, ScopeRecord>();
  // Keep navigation continuity when the heavier directory/content cache is evicted.
  private readonly lastSelections = new Map<string, string | undefined>();
  private readonly pendingReveals = new Map<string, { id: number; path: string }>();
  private readonly explorerViewState: ExplorerViewStateStore;
  private revealSequence = 0;
  private readonly createUploadBatchId: () => string;
  private readonly now: () => string;
  private uploadBatchSequence = 0;
  private useSequence = 0;
  private messages: ReturnType<typeof createFilesRuntimeMessages> | undefined;
  private readonly messageHandles = new WeakMap<PluginLocalization, ReturnType<typeof createFilesRuntimeMessages>>();

  constructor(dependencies: FilesRuntimeDependencies = {}) {
    this.explorerViewState = dependencies.explorerViewState ?? createExplorerViewStateStore();
    this.createUploadBatchId = dependencies.createUploadBatchId ?? (() => {
      this.uploadBatchSequence += 1;
      return `files-upload-${String(this.uploadBatchSequence)}`;
    });
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  /** Activation can attach localization after constructing the runtime. The UI owns locale subscriptions. */
  setLocalization(localization: PluginLocalization | undefined): void {
    if (localization === undefined) {
      this.messages = undefined;
      return;
    }
    let messages = this.messageHandles.get(localization);
    if (messages === undefined) {
      messages = createFilesRuntimeMessages(localization);
      this.messageHandles.set(localization, messages);
    }
    this.messages = messages;
  }

  private setDiagnostic(target: object, key: string, diagnostic: FilesRuntimeDiagnostic): void {
    setFilesRuntimeDiagnostic(target, key, () => formatFilesRuntimeDiagnostic(diagnostic, this.messages));
  }

  /** Upload review can resolve the same validation diagnostic without starting a batch. */
  formatError(error: unknown): string {
    return error instanceof FilesRuntimeValidationError ? formatFilesRuntimeDiagnostic(error.diagnostic, this.messages) : errorMessage(error);
  }

  private setError(target: object, key: string, error: unknown): void {
    if (error instanceof FilesRuntimeValidationError) this.setDiagnostic(target, key, error.diagnostic);
    else Object.defineProperty(target, key, { configurable: true, enumerable: true, writable: true, value: errorMessage(error) });
  }

  prepare(context: WorkspacePanelContext): FilesScopeState {
    const scope = this.bindContext(context);
    void this.synchronizeNavigation(scope);
    if (!scope.initialized && !scope.suspended && scope.capabilityError === undefined) {
      scope.initialized = true;
      void this.refreshFiles(context);
    }
    return scope;
  }

  snapshot(context: WorkspacePanelContext): FilesScopeState {
    const existing = this.scopes.get(scopeKey(context));
    if (existing === undefined) return this.bindContext(context);
    existing.lastUsed = ++this.useSequence;
    return existing;
  }

  subscribe(context: WorkspacePanelContext, listener: FilesScopeListener): () => void {
    const scope = this.bindContext(context);
    scope.suspended = false;
    scope.listeners.add(listener);
    return () => {
      scope.listeners.delete(listener);
      if (scope.listeners.size === 0) {
        scope.suspended = true;
        if (scope.selectedAbort !== undefined) {
          this.cancelSelectedRequest(scope);
          scope.selectedNeedsRestore = scope.selectedFilePath !== undefined;
        }
        this.cancelTreeRequests(scope, true);
      }
      this.evictInactiveScopes();
    };
  }

  async refreshFiles(context: WorkspacePanelContext): Promise<void> {
    const scope = this.bindContext(context);
    const refresh = this.loadTree(scope);
    scope.treeRefresh = refresh;
    try {
      await refresh;
    } finally {
      if (scope.treeRefresh === refresh) scope.treeRefresh = undefined;
    }
  }

  private async loadTree(scope: ScopeRecord): Promise<void> {
    const files = this.requireFiles(scope);
    if (files === undefined) return;
    scope.initialized = true;
    this.cancelTreeRequests(scope);
    const generation = ++scope.treeRequestGeneration;
    const abort = new AbortController();
    scope.treeAbort = abort;
    scope.treeLoading = true;
    this.notify(scope);
    try {
      const root = await files.listFiles("", { signal: abort.signal });
      if (!this.isCurrentTreeRequest(scope, generation, abort)) return;
      scope.fileTree = root.entries;
      const expanded = await loadExpandedDirectories(files, root.entries, new Set(scope.expandedPaths), abort.signal);
      if (!this.isCurrentTreeRequest(scope, generation, abort)) return;
      scope.expandedDirs = expanded;
      this.completeReveal(scope);
      scope.treeStale = false;
      delete scope.error;
    } catch (error) {
      if (!this.isCurrentTreeRequest(scope, generation, abort) || isAbortError(error)) return;
      abort.abort();
      this.setError(scope, "error", error);
    } finally {
      if (this.isCurrentTreeRequest(scope, generation, abort)) {
        scope.treeAbort = undefined;
        scope.treeLoading = false;
        this.notify(scope);
      }
    }
  }

  async expandDir(context: WorkspacePanelContext, path: string): Promise<void> {
    const scope = this.bindContext(context);
    const files = this.requireFiles(scope);
    if (files === undefined) return;
    this.cancelReveal(scope);
    this.cancelTreeRefreshForInteraction(scope);
    this.cancelExpandedRequest(scope, path);
    if (scope.expandedPaths.includes(path)) {
      scope.expandedPaths = scope.expandedPaths.filter((entry) => entry !== path);
      scope.expandedDirs = omitKey(scope.expandedDirs, path);
      this.saveExplorerView(scope);
      this.notify(scope);
      return;
    }
    scope.expandedPaths = [...scope.expandedPaths, path];
    this.saveExplorerView(scope);
    this.notify(scope);
    const abort = new AbortController();
    scope.expandedAborts.set(path, abort);
    try {
      const response = await files.listFiles(path, { signal: abort.signal });
      const descendants = await loadExpandedDirectories(files, response.entries, new Set(scope.expandedPaths), abort.signal);
      if (!this.isCurrentExpandedRequest(scope, path, abort)) return;
      scope.expandedDirs = { ...scope.expandedDirs, ...descendants, [path]: response.entries };
      delete scope.error;
    } catch (error) {
      if (!this.isCurrentExpandedRequest(scope, path, abort) || isAbortError(error)) return;
      this.setError(scope, "error", error);
    } finally {
      if (this.isCurrentExpandedRequest(scope, path, abort)) {
        scope.expandedAborts.delete(path);
        this.notify(scope);
      }
    }
  }

  /** Tree clicks open in place; uploads and other explicit destinations also reveal. */
  async selectFile(context: WorkspacePanelContext, path: string, intent: "open" | "reveal" = "open"): Promise<void> {
    const scope = this.bindContext(context);
    delete scope.selectedDirectoryPath;
    this.cancelReveal(scope);
    context.navigation?.set("file", path);
    const reveal = intent === "reveal" ? this.revealFile(scope, path) : Promise.resolve();
    await Promise.all([this.restoreFile(scope, path), reveal]);
  }

  rememberScroll(context: WorkspacePanelContext, scrollTop: number): void {
    const scope = this.bindContext(context);
    if (!Number.isFinite(scrollTop) || scrollTop < 0 || scope.scrollTop === scrollTop) return;
    scope.scrollTop = scrollTop;
    this.saveExplorerView(scope);
  }

  acknowledgeReveal(context: WorkspacePanelContext, id: number, scrollTop: number): void {
    const scope = this.bindContext(context);
    if (scope.revealRequest?.id !== id) return;
    this.cancelReveal(scope);
    this.rememberScroll(context, scrollTop);
  }

  private saveExplorerView(scope: ScopeRecord): void {
    this.explorerViewState.write(scope.key, { expandedPaths: scope.expandedPaths, scrollTop: scope.scrollTop });
  }

  private cancelReveal(scope: ScopeRecord): void {
    scope.pendingReveal = undefined;
    this.pendingReveals.delete(scope.key);
    delete scope.revealRequest;
  }

  private revealFile(scope: ScopeRecord, path: string): Promise<void> {
    const request = { id: ++this.revealSequence, path };
    scope.pendingReveal = request;
    this.pendingReveals.set(scope.key, request);
    delete scope.revealRequest;
    scope.expandedPaths = [...new Set([...scope.expandedPaths, ...ancestorDirectories(path)])];
    this.saveExplorerView(scope);
    if (scope.suspended) return Promise.resolve();
    return this.refreshFiles(scope.context);
  }

  private completeReveal(scope: ScopeRecord): void {
    const request = scope.pendingReveal;
    if (request !== undefined && treeContainsFile(scope.fileTree, scope.expandedDirs, request.path)) {
      scope.revealRequest = request;
    }
  }

  clearSelection(context: WorkspacePanelContext): void {
    const scope = this.bindContext(context);
    context.navigation?.set("file", undefined);
    this.cancelReveal(scope);
    this.lastSelections.set(scope.key, undefined);
    this.cancelSelectedRequest(scope);
    delete scope.selectedFilePath;
    delete scope.selectedDirectoryPath;
    delete scope.selectedFileContent;
    delete scope.selectedFileLoadError;
    scope.selectedNeedsRestore = false;
    this.notify(scope);
  }

  selectDirectory(context: WorkspacePanelContext, path: string): void {
    this.clearSelection(context);
    const scope = this.bindContext(context);
    scope.selectedDirectoryPath = path;
    this.notify(scope);
  }

  async createFile(context: WorkspacePanelContext, path: string): Promise<void> {
    await this.mutate(context, (files) => files.writeFile(path, "", { createDirs: true, overwrite: false }),
      () => this.selectFile(context, path));
  }

  async createDirectory(context: WorkspacePanelContext, path: string): Promise<void> {
    await this.mutate(context, (files) => {
      if (files.createDirectory === undefined) throw new Error(t("ui.main.824e9505656f", "The current host does not support creating folders"));
      return files.createDirectory(path);
    }, () => { this.selectDirectory(context, path); });
  }

  async moveSelectedPath(context: WorkspacePanelContext, toPath: string): Promise<void> {
    const scope = this.bindContext(context);
    const fromPath = scope.selectedDirectoryPath ?? scope.selectedFilePath;
    if (fromPath === undefined || fromPath === "" || fromPath === toPath) return;
    const directory = scope.selectedDirectoryPath !== undefined;
    await this.mutate(context, (files) => {
      if (!directory) return files.moveFile(fromPath, toPath, { overwrite: false });
      if (files.moveDirectory === undefined) throw new Error(t("ui.main.edac88843cde", "The current host does not support moving folders"));
      return files.moveDirectory(fromPath, toPath);
    }, async () => {
      if (directory) this.selectDirectory(context, toPath);
      else await this.selectFile(context, toPath);
    }, fromPath);
  }

  async deleteSelectedPath(context: WorkspacePanelContext): Promise<void> {
    const scope = this.bindContext(context);
    const path = scope.selectedDirectoryPath ?? scope.selectedFilePath;
    if (path === undefined || path === "") return;
    const directory = scope.selectedDirectoryPath !== undefined;
    await this.mutate(context, (files) => {
      if (!directory) return files.deleteFile(path);
      if (files.deleteDirectory === undefined) throw new Error(t("ui.main.5e12c72deb80", "The current host does not support deleting empty folders"));
      return files.deleteDirectory(path);
    }, () => { this.clearSelection(context); }, path);
  }

  private async mutate(context: WorkspacePanelContext, operation: (files: WorkspaceFilesCapabilityV1) => Promise<unknown>,
    onSelected: () => void | Promise<void>, removedPath?: string): Promise<void> {
    const scope = this.bindContext(context);
    const files = this.requireFiles(scope);
    if (files === undefined || scope.mutating === true) return;
    const generation = scope.selectedRequestGeneration;
    scope.mutating = true;
    delete scope.error;
    this.notify(scope);
    try {
      await operation(files);
      if (removedPath !== undefined) {
        this.cancelTreeRequests(scope);
        scope.expandedDirs = Object.fromEntries(Object.entries(scope.expandedDirs)
          .filter(([path]) => path !== removedPath && !path.startsWith(`${removedPath}/`)));
      }
      scope.treeStale = true;
      if (!scope.suspended) {
        await this.refreshFiles(scope.context);
        if (mutationSelectionCurrent(scope, generation)) await onSelected();
      }
    } catch (error) {
      scope.error = errorMessage(error);
    } finally {
      scope.mutating = false;
      this.notify(scope);
    }
  }

  startWorkspaceUpload(
    context: WorkspacePanelContext,
    filesToUpload: readonly File[],
    options: StartWorkspaceUploadOptions,
  ): WorkspaceUploadRun | undefined {
    const scope = this.bindContext(context);
    const files = this.requireFiles(scope);
    if (files === undefined || filesToUpload.length === 0) return undefined;

    let batch: WorkspaceUploadBatchState;
    try {
      batch = createUploadBatch(
        this.createUploadBatchId(),
        filesToUpload,
        options.destinationFolder,
        options.overwrite ?? false,
        options.createDirs ?? true,
        this.now(),
      );
    } catch (error) {
      this.setError(scope, "error", error);
      this.notify(scope);
      return undefined;
    }

    scope.uploadBatches = { ...scope.uploadBatches, [batch.id]: batch };
    this.notify(scope);
    const done = this.runWorkspaceUpload(scope, files, filesToUpload, batch, options);
    return { batchId: batch.id, done };
  }

  cancelWorkspaceUpload(context: WorkspacePanelContext, batchId: string): void {
    const scope = this.bindContext(context);
    const batch = scope.uploadBatches[batchId];
    if (batch?.status !== "uploading") return;
    scope.cancelledUploads.add(batchId);
    scope.uploadTasks.get(batchId)?.cancel();
    cancelUploadBatch(batch, this.now(), () => formatFilesRuntimeDiagnostic({ key: "uploadCancelled" }, this.messages));
    this.notify(scope);
  }

  clearWorkspaceUpload(context: WorkspacePanelContext, batchId: string): void {
    const scope = this.bindContext(context);
    const batch = scope.uploadBatches[batchId];
    const task = scope.uploadTasks.get(batchId);
    if (batch?.status === "uploading" || task !== undefined) {
      scope.cancelledUploads.add(batchId);
      task?.cancel();
      if (batch !== undefined) cancelUploadBatch(batch, this.now(), () => formatFilesRuntimeDiagnostic({ key: "uploadCancelled" }, this.messages));
    } else {
      scope.cancelledUploads.delete(batchId);
    }
    scope.uploadTasks.delete(batchId);
    scope.uploadBatches = omitKey(scope.uploadBatches, batchId);
    this.notify(scope);
    this.evictInactiveScopes();
  }

  async invalidate(context: WorkspacePanelContext, invalidation?: WorkspaceInvalidation): Promise<void> {
    const scope = this.bindContext(context);
    const treeGeneration = scope.treeRequestGeneration;
    const navigationRestore = this.synchronizeNavigation(scope);
    scope.treeStale = true;
    if (scope.suspended) {
      this.cancelTreeRequests(scope, true);
      await navigationRestore;
      return;
    }
    this.notify(scope);
    if (hasInFlightUpload(scope)) {
      await navigationRestore;
      return;
    }
    // Route finalization can arrive while mounting the same tree. A mutation
    // or activity event instead requires a snapshot taken after the change.
    const treeRefresh = scope.treeRequestGeneration !== treeGeneration || (invalidation === undefined && scope.treeRefresh !== undefined)
      ? scope.treeRefresh
      : this.refreshFiles(context);
    await Promise.all([navigationRestore, treeRefresh]);
  }

  private bindContext(context: WorkspacePanelContext): ScopeRecord {
    const key = scopeKey(context);
    let scope = this.scopes.get(key);
    if (scope === undefined) {
      const remembered = this.explorerViewState.read(key);
      const lastSelection = this.lastSelections.get(key);
      scope = {
        key,
        machineId: context.machine.id,
        projectId: context.workspace.projectId,
        workspaceId: context.workspace.id,
        context,
        fileTree: [],
        expandedDirs: {},
        expandedPaths: remembered?.expandedPaths ?? [],
        scrollTop: remembered?.scrollTop ?? 0,
        ...(lastSelection === undefined ? {} : { selectedFilePath: lastSelection }),
        treeLoading: false,
        treeStale: false,
        uploadBatches: {},
        files: undefined,
        navigationSnapshot: undefined,
        pendingReveal: this.pendingReveals.get(key),
        listeners: new Set(),
        selectedRequestGeneration: 0,
        selectedAbort: undefined,
        selectedNeedsRestore: lastSelection !== undefined,
        treeRequestGeneration: 0,
        treeAbort: undefined,
        treeRefresh: undefined,
        expandedAborts: new Map(),
        initialized: false,
        suspended: false,
        lastUsed: 0,
        uploadTasks: new Map(),
        cancelledUploads: new Set(),
      };
      this.scopes.set(key, scope);
    }
    scope.context = context;
    scope.lastUsed = ++this.useSequence;
    const capability = workspaceFilesCapabilityV1(context.files);
    scope.files = capability;
    const capabilityError = filesCapabilityError(context.files, context.navigation);
    if (capabilityError === undefined) delete scope.capabilityError;
    else this.setDiagnostic(scope, "capabilityError", capabilityError);
    this.evictInactiveScopes(scope.key);
    return scope;
  }

  private requireFiles(scope: ScopeRecord): WorkspaceFilesCapabilityV1 | undefined {
    if (scope.files !== undefined && scope.capabilityError === undefined) return scope.files;
    if (scope.capabilityError === undefined) this.setDiagnostic(scope, "capabilityError", { key: "capabilities" });
    this.notify(scope);
    return undefined;
  }

  private synchronizeNavigation(scope: ScopeRecord): Promise<void> {
    if (scope.navigationSnapshot === scope.context.navigation && !scope.selectedNeedsRestore) return Promise.resolve();
    scope.navigationSnapshot = scope.context.navigation;
    return this.restoreNavigationSelection(scope);
  }

  private async restoreNavigationSelection(scope: ScopeRecord): Promise<void> {
    if (scope.capabilityError !== undefined) return;
    const selectedPath = firstQueryString(scope.navigationSnapshot?.query["file"]);
    const destinationChanged = selectedPath !== scope.selectedFilePath;
    if (scope.suspended) {
      if (destinationChanged) {
        this.cancelReveal(scope);
        if (selectedPath !== undefined && selectedPath !== "") void this.revealFile(scope, selectedPath);
      }
      this.lastSelections.set(scope.key, selectedPath);
      this.cancelSelectedRequest(scope);
      if (selectedPath === undefined || selectedPath === "") delete scope.selectedFilePath;
      else scope.selectedFilePath = selectedPath;
      delete scope.selectedFileContent;
      delete scope.selectedFileLoadError;
      scope.selectedNeedsRestore = selectedPath !== undefined && selectedPath !== "";
      return;
    }
    if (selectedPath === scope.selectedFilePath && !scope.selectedNeedsRestore) return;
    if (selectedPath === undefined || selectedPath === "") {
      this.cancelReveal(scope);
      this.lastSelections.set(scope.key, undefined);
      this.cancelSelectedRequest(scope);
      delete scope.selectedFilePath;
      delete scope.selectedFileContent;
      delete scope.selectedFileLoadError;
      scope.selectedNeedsRestore = false;
      this.notify(scope);
      return;
    }
    const reveal = destinationChanged ? this.revealFile(scope, selectedPath) : Promise.resolve();
    await Promise.all([this.restoreFile(scope, selectedPath), reveal]);
  }

  private async restoreFile(scope: ScopeRecord, path: string): Promise<void> {
    delete scope.selectedDirectoryPath;
    const files = this.requireFiles(scope);
    if (files === undefined) return;
    this.cancelSelectedRequest(scope);
    const generation = ++scope.selectedRequestGeneration;
    const abort = new AbortController();
    scope.selectedAbort = abort;
    scope.selectedNeedsRestore = false;
    scope.selectedFilePath = path;
    this.lastSelections.set(scope.key, path);
    delete scope.selectedFileContent;
    delete scope.selectedFileLoadError;
    this.notify(scope);
    try {
      const content = await files.readFile(path, { signal: abort.signal });
      if (!this.isCurrentFileRequest(scope, generation, path)) return;
      scope.selectedFileContent = content;
      delete scope.selectedFileLoadError;
    } catch (error) {
      if (!this.isCurrentFileRequest(scope, generation, path) || isAbortError(error)) return;
      delete scope.selectedFileContent;
      this.setError(scope, "selectedFileLoadError", error);
    } finally {
      if (this.isCurrentFileRequest(scope, generation, path)) scope.selectedAbort = undefined;
      this.notify(scope);
    }
  }

  private isCurrentFileRequest(scope: ScopeRecord, generation: number, path: string): boolean {
    return scope.selectedRequestGeneration === generation && scope.selectedFilePath === path;
  }

  private isCurrentTreeRequest(scope: ScopeRecord, generation: number, abort: AbortController): boolean {
    return scope.treeRequestGeneration === generation && scope.treeAbort === abort;
  }

  private isCurrentExpandedRequest(scope: ScopeRecord, path: string, abort: AbortController): boolean {
    return scope.expandedAborts.get(path) === abort;
  }

  private cancelTreeRequests(scope: ScopeRecord, markForRestore = false): void {
    scope.treeRequestGeneration += 1;
    scope.treeAbort?.abort();
    scope.treeAbort = undefined;
    scope.treeRefresh = undefined;
    for (const abort of scope.expandedAborts.values()) abort.abort();
    scope.expandedAborts.clear();
    if (!markForRestore) return;
    scope.initialized = false;
    scope.treeLoading = false;
    scope.treeStale = true;
  }

  private cancelTreeRefreshForInteraction(scope: ScopeRecord): void {
    if (scope.treeAbort === undefined) return;
    scope.treeRequestGeneration += 1;
    scope.treeAbort.abort();
    scope.treeAbort = undefined;
    scope.treeRefresh = undefined;
    scope.treeLoading = false;
    scope.treeStale = true;
  }

  private cancelExpandedRequest(scope: ScopeRecord, path: string): void {
    scope.expandedAborts.get(path)?.abort();
    scope.expandedAborts.delete(path);
  }

  private cancelSelectedRequest(scope: ScopeRecord): void {
    scope.selectedRequestGeneration += 1;
    scope.selectedAbort?.abort();
    scope.selectedAbort = undefined;
  }

  private async runWorkspaceUpload(
    scope: ScopeRecord,
    files: WorkspaceFilesCapabilityV1,
    filesToUpload: readonly File[],
    batch: WorkspaceUploadBatchState,
    options: StartWorkspaceUploadOptions,
  ): Promise<void> {
    const successful: WriteWorkspaceFileResponse[] = [];
    try {
      for (let index = 0; index < filesToUpload.length; index += 1) {
        if (!this.isLiveUploadingBatch(scope, batch)) break;
        const file = filesToUpload[index];
        const fileState = batch.files[index];
        if (file === undefined || fileState === undefined) continue;
        batch.currentFileIndex = index;
        fileState.status = "uploading";
        this.recalculateUploadProgress(batch);
        this.notify(scope);

        let task: WorkspaceFileUploadTask;
        try {
          task = files.uploadFile(file, {
            destinationFolder: options.destinationFolder,
            createDirs: options.createDirs ?? true,
            overwrite: options.overwrite ?? false,
            onProgress: (progress) => {
              if (!this.isLiveUploadingBatch(scope, batch)) return;
              fileState.loaded = Math.min(progress.loaded, progress.total);
              fileState.total = progress.total;
              fileState.percent = progress.percent;
              fileState.lengthComputable = progress.lengthComputable;
              this.recalculateUploadProgress(batch);
              this.notify(scope);
            },
          });
        } catch (error) {
          this.failUploadFile(batch, fileState, error);
          this.notify(scope);
          continue;
        }
        fileState.path = task.path;
        scope.uploadTasks.set(batch.id, task);
        try {
          const response = await task.completed;
          if (!this.isLiveUploadingBatch(scope, batch)) continue;
          fileState.path = response.path;
          fileState.loaded = fileState.total;
          fileState.percent = 1;
          fileState.lengthComputable = true;
          fileState.status = "completed";
          fileState.response = response;
          delete fileState.error;
          successful.push(response);
        } catch (error) {
          if (scope.cancelledUploads.has(batch.id) || isAbortError(error)) {
            if (scope.uploadBatches[batch.id] === batch) cancelUploadBatch(batch, this.now(), () => formatFilesRuntimeDiagnostic({ key: "uploadCancelled" }, this.messages));
            break;
          }
          this.failUploadFile(batch, fileState, error);
        } finally {
          if (scope.uploadTasks.get(batch.id) === task) scope.uploadTasks.delete(batch.id);
          this.recalculateUploadProgress(batch, batch.status !== "uploading");
          this.notify(scope);
        }
      }

      if (scope.uploadBatches[batch.id] !== batch) return;
      if (batch.status === "cancelled") {
        await this.refreshAfterUploadSuccess(scope, batch, successful, options);
        return;
      }
      const failed = batch.files.filter((file) => file.status === "error");
      batch.status = failed.length === 0 ? "completed" : "error";
      batch.completedAt = this.now();
      if (failed.length === 0) delete batch.error;
      else if (failed.length === 1) {
        setFilesRuntimeDiagnostic(batch, "error", () => failed[0]?.error ?? formatFilesRuntimeDiagnostic({ key: "uploadFailed" }, this.messages));
      } else this.setDiagnostic(batch, "error", { key: "uploadsFailed", count: failed.length });
      for (const pending of batch.files.filter((file) => file.status === "pending" || file.status === "uploading")) {
        pending.status = "cancelled";
        this.setDiagnostic(pending, "error", { key: "notUploaded" });
      }
      this.recalculateUploadProgress(batch, true);
      this.notify(scope);

      await this.refreshAfterUploadSuccess(scope, batch, successful, options);
    } finally {
      scope.uploadTasks.delete(batch.id);
      scope.cancelledUploads.delete(batch.id);
      this.evictInactiveScopes();
    }
  }

  private async refreshAfterUploadSuccess(
    scope: ScopeRecord,
    batch: WorkspaceUploadBatchState,
    successful: readonly WriteWorkspaceFileResponse[],
    options: StartWorkspaceUploadOptions,
  ): Promise<void> {
    if (successful.length === 0 || scope.uploadBatches[batch.id] !== batch) return;
    const firstPath = successful[0]?.path;
    if (scope.suspended) {
      scope.initialized = false;
      scope.treeStale = true;
      if (options.selectUploadedFile !== false && firstPath !== undefined) {
        scope.context.navigation?.set("file", firstPath);
        this.cancelSelectedRequest(scope);
        scope.selectedFilePath = firstPath;
        this.lastSelections.set(scope.key, firstPath);
        void this.revealFile(scope, firstPath);
        delete scope.selectedFileContent;
        delete scope.selectedFileLoadError;
        scope.selectedNeedsRestore = true;
      }
      return;
    }
    await this.refreshFiles(scope.context);
    if (options.selectUploadedFile !== false && firstPath !== undefined && scope.uploadBatches[batch.id] === batch) {
      await this.selectFile(scope.context, firstPath, "reveal");
    }
  }

  private isLiveUploadingBatch(scope: ScopeRecord, batch: WorkspaceUploadBatchState): boolean {
    return scope.uploadBatches[batch.id] === batch && batch.status === "uploading" && !scope.cancelledUploads.has(batch.id);
  }

  private failUploadFile(batch: WorkspaceUploadBatchState, file: WorkspaceUploadFileState, error: unknown): void {
    file.loaded = file.total;
    file.percent = 1;
    file.lengthComputable = true;
    file.status = "error";
    this.setError(file, "error", error);
  }

  private recalculateUploadProgress(batch: WorkspaceUploadBatchState, terminal = false): void {
    batch.total = batch.files.reduce((sum, file) => sum + file.total, 0);
    batch.loaded = batch.files.reduce((sum, file) => sum + file.loaded, 0);
    batch.percent = terminal ? 1 : percentFor(batch.loaded, batch.total);
  }

  private notify(scope: ScopeRecord): void {
    const snapshot: FilesScopeState = scope;
    for (const listener of [...scope.listeners]) listener(snapshot, scope.context);
    if (scope.listeners.size === 0 && !scope.suspended) scope.context.host.requestRender();
  }

  private evictInactiveScopes(protectedKey?: string): void {
    if (this.scopes.size <= MAX_RECENT_SCOPES) return;
    const candidates = [...this.scopes.values()]
      .filter((scope) => scope.key !== protectedKey && scope.listeners.size === 0 && !hasInFlightUpload(scope))
      .sort((left, right) => left.lastUsed - right.lastUsed);
    while (this.scopes.size > MAX_RECENT_SCOPES) {
      const candidate = candidates.shift();
      if (candidate === undefined) break;
      this.cancelSelectedRequest(candidate);
      this.cancelTreeRequests(candidate);
      this.scopes.delete(candidate.key);
    }
    if (this.scopes.size <= MAX_RECENT_SCOPES) return;
    for (const scope of this.scopes.values()) {
      if (scope.key === protectedKey || scope.listeners.size > 0 || scope.selectedFileContent === undefined) continue;
      delete scope.selectedFileContent;
      scope.selectedNeedsRestore = scope.selectedFilePath !== undefined;
    }
  }
}

function ancestorDirectories(path: string): string[] {
  const segments = path.split("/");
  return segments.slice(0, -1).map((_segment, index) => segments.slice(0, index + 1).join("/"));
}

/** Walk actual listings, so remembered folders that were deleted do not break restoration. */
async function loadExpandedDirectories(
  files: WorkspaceFilesCapabilityV1,
  entries: readonly FileTreeEntry[],
  expandedPaths: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<Record<string, FileTreeEntry[]>> {
  const paths = entries.filter((entry) => entry.type === "directory" && expandedPaths.has(entry.path)).map((entry) => entry.path);
  if (paths.length === 0) return {};
  const batch = paths.length > 1 ? await files.listFilesBatch?.(paths, { signal }) : undefined;
  const results = batch === undefined ? undefined : new Map(batch.results.map((result) => [result.path, result]));
  const level = await Promise.all(paths.map(async (path) => {
    if (results === undefined) return [path, (await files.listFiles(path, { signal })).entries] as const;
    const result = results.get(path);
    if (result === undefined) throw new Error(t("ui.workspaceFilesPanel.missingDirectoryListing", "The file tree response omitted a directory."));
    if ("error" in result) throw new Error(result.error);
    return [path, result.tree.entries] as const;
  }));
  signal.throwIfAborted();
  const descendants = await loadExpandedDirectories(files, level.flatMap(([, children]) => children), expandedPaths, signal);
  return { ...descendants, ...Object.fromEntries(level) };
}

function treeContainsFile(entries: readonly FileTreeEntry[], expanded: Record<string, FileTreeEntry[]>, path: string): boolean {
  return entries.some((entry) => entry.type === "directory"
    ? treeContainsFile(Object.hasOwn(expanded, entry.path) ? expanded[entry.path] ?? [] : [], expanded, path)
    : entry.path === path);
}

export function workspaceFilesCapabilityV1(files: WorkspaceFilesContextValue): WorkspaceFilesCapabilityV1 | undefined {
  return files.capabilityVersion === 1 ? files : undefined;
}

export function workspaceUploadPath(destinationFolder: string, fileName: string): string {
  const folder = normalizeWorkspaceUploadPath(destinationFolder, "destination", { allowEmpty: true });
  const name = normalizeWorkspaceUploadPath(fileName, "name", { allowEmpty: false });
  return folder === "" ? name : `${folder}/${name}`;
}

function filesCapabilityError(files: WorkspaceFilesContextValue, navigation: WorkspacePanelNavigationV1 | undefined): FilesRuntimeDiagnostic | undefined {
  if (files.capabilityVersion !== 1) return { key: "filesCapability" };
  if (navigation?.version !== 1) return { key: "navigationCapability" };
  return undefined;
}

function scopeKey(context: WorkspacePanelContext): string {
  return JSON.stringify([context.machine.id, context.workspace.projectId, context.workspace.id]);
}

function firstQueryString(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function createUploadBatch(
  id: string,
  files: readonly File[],
  destinationFolder: string,
  overwrite: boolean,
  createDirs: boolean,
  startedAt: string,
): WorkspaceUploadBatchState {
  const uploadFiles = files.map((file, index): WorkspaceUploadFileState => ({
    index,
    name: file.name,
    path: workspaceUploadPath(destinationFolder, file.name),
    size: file.size,
    loaded: 0,
    total: file.size,
    percent: percentFor(0, file.size),
    lengthComputable: true,
    status: index === 0 ? "uploading" : "pending",
  }));
  const total = uploadFiles.reduce((sum, file) => sum + file.total, 0);
  return {
    id,
    destinationFolder,
    overwrite,
    createDirs,
    files: uploadFiles,
    currentFileIndex: uploadFiles.length === 0 ? -1 : 0,
    loaded: 0,
    total,
    percent: percentFor(0, total),
    status: "uploading",
    startedAt,
  };
}

function cancelUploadBatch(batch: WorkspaceUploadBatchState, completedAt: string, display: () => string): void {
  batch.status = "cancelled";
  batch.completedAt = completedAt;
  setFilesRuntimeDiagnostic(batch, "error", display);
  for (const file of batch.files) {
    if (file.status === "completed" || file.status === "error") continue;
    file.status = "cancelled";
    setFilesRuntimeDiagnostic(file, "error", display);
  }
  batch.loaded = batch.total;
  batch.percent = 1;
}

function normalizeWorkspaceUploadPath(value: string, label: "destination" | "name", options: { allowEmpty: boolean }): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    if (options.allowEmpty) return "";
    throw new FilesRuntimeValidationError({ key: `${label}Empty` });
  }
  const withForwardSlashes = trimmed.replace(/\\/gu, "/");
  if (withForwardSlashes.startsWith("/") || /^[A-Za-z]:\//u.test(withForwardSlashes)) throw new FilesRuntimeValidationError({ key: `${label}Relative` });
  const parts = withForwardSlashes.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) {
    if (options.allowEmpty) return "";
    throw new FilesRuntimeValidationError({ key: `${label}Empty` });
  }
  if (parts.some((part) => part === "..")) throw new FilesRuntimeValidationError({ key: `${label}Traversal` });
  return parts.join("/");
}

function hasInFlightUpload(scope: ScopeRecord): boolean {
  return scope.mutating === true || scope.uploadTasks.size > 0
    || Object.values(scope.uploadBatches).some((batch) => batch.status === "uploading");
}

function mutationSelectionCurrent(scope: ScopeRecord, generation: number): boolean {
  return !scope.suspended && scope.selectedRequestGeneration === generation;
}

function percentFor(loaded: number, total: number): number {
  if (total <= 0) return loaded <= 0 ? 0 : 1;
  return Math.max(0, Math.min(1, loaded / total));
}

function omitKey<T>(record: Record<string, T>, keyToOmit: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToOmit));
}

function isAbortError(error: unknown): boolean {
  return (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && error.name === "AbortError");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

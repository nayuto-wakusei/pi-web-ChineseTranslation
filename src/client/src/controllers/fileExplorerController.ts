import {
  api as defaultApi,
  uploadWorkspaceFiles as defaultUploadWorkspaceFiles,
  WorkspaceUploadBatchError,
  WorkspaceUploadCancelledError,
  type WorkspaceUploadBatchProgress,
  type WorkspaceUploadTask,
  type WriteWorkspaceFileResponse,
} from "../api";
import { queryNamespace, setNamespacedQueryKey } from "../namespacedQueryArgs";
import {
  cancelWorkspaceUploadBatch,
  completeWorkspaceUploadBatch,
  createWorkspaceUploadBatchState,
  failWorkspaceUploadBatch,
  updateWorkspaceUploadBatchProgress,
  type WorkspaceUploadBatchState,
} from "../workspaceUploadState";
import { selectedMachineId, type GetState, type SetState, type UpdateUrl } from "./types";

const FILES_ROUTE_NAMESPACE = queryNamespace("core:workspace.files");

type FileExplorerApi = Pick<typeof defaultApi, "workspaceFile" | "workspaceTree" | "workspaceTreeBatch" | "createWorkspaceFile" | "createWorkspaceDirectory" | "moveWorkspaceFile" | "moveWorkspaceDirectory" | "deleteWorkspaceFile" | "deleteWorkspaceDirectory" | "downloadWorkspaceFile">;
type UploadWorkspaceFiles = typeof defaultUploadWorkspaceFiles;

interface WorkspaceRequestIdentity {
  machineId: string;
  projectId: string;
  workspaceId: string;
}

interface FileRequestIdentity extends WorkspaceRequestIdentity {
  generation: number;
  path: string;
}

export interface FileExplorerControllerDependencies {
  api?: FileExplorerApi;
  uploadWorkspaceFiles?: UploadWorkspaceFiles;
  createUploadBatchId?: () => string;
  now?: () => string;
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

export class FileExplorerController {
  private readonly api: FileExplorerApi;
  private readonly uploadWorkspaceFiles: UploadWorkspaceFiles;
  private readonly createUploadBatchId: () => string;
  private readonly now: () => string;
  private readonly uploadTasks = new Map<string, WorkspaceUploadTask<WriteWorkspaceFileResponse[]>>();
  private uploadBatchSequence = 0;
  private fileRequestGeneration = 0;
  private treeRequestGeneration = 0;
  private directoryRequestSequence = 0;
  private readonly directoryRequestGeneration = new Map<string, number>();
  private refreshInFlight: Promise<void> | undefined;
  private refreshPending = false;

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly updateUrl: UpdateUrl,
    deps: FileExplorerControllerDependencies = {},
  ) {
    this.api = deps.api ?? defaultApi;
    this.uploadWorkspaceFiles = deps.uploadWorkspaceFiles ?? defaultUploadWorkspaceFiles;
    this.createUploadBatchId = deps.createUploadBatchId ?? (() => {
      this.uploadBatchSequence += 1;
      return `workspace-upload-${String(this.uploadBatchSequence)}`;
    });
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  refreshFiles(): Promise<void> {
    this.refreshPending = true;
    this.refreshInFlight ??= this.refreshLoop().finally(() => { this.refreshInFlight = undefined; });
    return this.refreshInFlight;
  }

  private async refreshLoop(): Promise<void> {
    while (this.consumeRefresh()) {
      await this.refreshFileTree();
    }
  }

  private consumeRefresh(): boolean {
    const pending = this.refreshPending;
    this.refreshPending = false;
    return pending;
  }

  private async refreshFileTree(): Promise<void> {
    const state = this.getState();
    const project = state.selectedProject;
    const workspace = state.selectedWorkspace;
    if (project === undefined || workspace === undefined) return;
    const request = { projectId: project.id, workspaceId: workspace.id, machineId: selectedMachineId(state) };
    const generation = ++this.treeRequestGeneration;
    const expandedDirs = state.expandedDirs;
    const isCurrent = () => generation === this.treeRequestGeneration && this.isCurrentWorkspace(request);
    try {
      const machineId = request.machineId;
      const paths = ["", ...Object.keys(expandedDirs)];
      const results = [];
      for (let offset = 0; offset < paths.length; offset += 128) {
        const batch = await this.api.workspaceTreeBatch(project.id, workspace.id, paths.slice(offset, offset + 128), machineId);
        results.push(...batch.results);
      }
      const root = results.find((item) => item.path === "");
      if (root === undefined || !("tree" in root)) throw new Error(root?.error ?? "Unable to load file tree");
      const expandedEntries = results.filter((item) => item.path !== "").map((item) => [item.path, "tree" in item ? item.tree.entries : undefined] as const);
      if (!isCurrent()) return;
      let expanded = { ...this.getState().expandedDirs };
      for (const [path, entries] of expandedEntries) {
        // Keep expansions and collapses made while the refresh was in flight.
        if (expanded[path] !== expandedDirs[path]) continue;
        if (entries === undefined) expanded = omitKey(expanded, path);
        else expanded[path] = entries;
      }
      this.setState({ fileTree: root.tree.entries, expandedDirs: expanded, fileTreeStale: false, error: "" });
    } catch (error) {
      if (!isCurrent()) return;
      this.setState({ error: String(error) });
    }
  }

  async expandDir(path: string): Promise<void> {
    const state = this.getState();
    const project = state.selectedProject;
    const workspace = state.selectedWorkspace;
    if (project === undefined || workspace === undefined) return;
    const request = { projectId: project.id, workspaceId: workspace.id, machineId: selectedMachineId(state) };
    const generation = ++this.directoryRequestSequence;
    this.directoryRequestGeneration.set(path, generation);
    const isCurrent = () => this.directoryRequestGeneration.get(path) === generation && this.isCurrentWorkspace(request);
    if (this.getState().expandedDirs[path] !== undefined) {
      this.directoryRequestGeneration.delete(path);
      this.setState({ expandedDirs: omitKey(this.getState().expandedDirs, path) });
      return;
    }
    try {
      const response = await this.api.workspaceTree(project.id, workspace.id, path, request.machineId);
      if (!isCurrent()) return;
      this.setState({ expandedDirs: { ...this.getState().expandedDirs, [path]: response.entries }, error: "" });
    } catch (error) {
      if (!isCurrent()) return;
      this.setState({ error: String(error) });
    } finally {
      if (this.directoryRequestGeneration.get(path) === generation) this.directoryRequestGeneration.delete(path);
    }
  }

  private isCurrentWorkspace(request: WorkspaceRequestIdentity): boolean {
    const state = this.getState();
    return state.selectedProject?.id === request.projectId
      && state.selectedWorkspace?.id === request.workspaceId
      && selectedMachineId(state) === request.machineId;
  }

  private async refreshParents(paths: readonly string[]): Promise<void> {
    this.treeRequestGeneration += 1;
    const state = this.getState();
    if (state.selectedProject === undefined || state.selectedWorkspace === undefined) return;
    const request = { projectId: state.selectedProject.id, workspaceId: state.selectedWorkspace.id, machineId: selectedMachineId(state) };
    const parents = [...new Set(paths.map((path) => {
      let parent = parentPath(path);
      while (parent !== "" && state.expandedDirs[parent] === undefined) parent = parentPath(parent);
      return parent;
    }))];
    if (parents.length === 0) return;
    const results = [];
    for (let offset = 0; offset < parents.length; offset += 128) {
      const response = await this.api.workspaceTreeBatch(request.projectId, request.workspaceId, parents.slice(offset, offset + 128), request.machineId);
      results.push(...response.results);
    }
    if (!this.isCurrentWorkspace(request)) return;
    const expandedDirs = { ...this.getState().expandedDirs };
    let fileTree = this.getState().fileTree;
    for (const item of results) {
      if (!("tree" in item)) throw new Error(item.error);
      if (item.path === "") fileTree = item.tree.entries;
      else if (expandedDirs[item.path] !== undefined) expandedDirs[item.path] = item.tree.entries;
    }
    this.setState({ fileTree, expandedDirs });
  }

  private removeExpandedSubtree(path: string): void {
    for (const key of this.directoryRequestGeneration.keys()) if (key === path || key.startsWith(`${path}/`)) this.directoryRequestGeneration.delete(key);
    const expandedDirs = Object.fromEntries(Object.entries(this.getState().expandedDirs).filter(([key]) => key !== path && !key.startsWith(`${path}/`)));
    this.setState({ expandedDirs });
  }

  async selectFile(path: string): Promise<void> {
    this.setState({ selectedFilePath: path, selectedFileContent: undefined, selectedFileLoadError: undefined, workspaceTool: "core:workspace.files", mainView: this.getState().mainView === "chat" ? "chat" : "core:workspace.files" });
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", path);
    this.updateUrl({ replace: true });
    await this.restoreFile(path);
  }

  selectDirectory(path: string): void {
    this.fileRequestGeneration += 1;
    this.setState({ selectedFilePath: path, selectedFileContent: undefined, selectedFileLoadError: undefined, workspaceTool: "core:workspace.files", mainView: this.getState().mainView === "chat" ? "chat" : "core:workspace.files" });
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", undefined, { replace: true });
    this.updateUrl({ replace: true });
  }

  async restoreFile(path: string): Promise<void> {
    const generation = ++this.fileRequestGeneration;
    const state = this.getState();
    const project = state.selectedProject;
    const workspace = state.selectedWorkspace;
    if (project === undefined || workspace === undefined) return;
    const request: FileRequestIdentity = { generation, machineId: selectedMachineId(state), projectId: project.id, workspaceId: workspace.id, path };
    this.setState({ selectedFilePath: path, selectedFileContent: undefined, selectedFileLoadError: undefined });
    try {
      const content = await this.api.workspaceFile(request.projectId, request.workspaceId, request.path, request.machineId);
      if (!this.isCurrentFileRequest(request)) return;
      this.setState({ selectedFileContent: content, selectedFileLoadError: undefined, error: "" });
    } catch (error) {
      if (!this.isCurrentFileRequest(request)) return;
      this.setState({ selectedFileContent: undefined, selectedFileLoadError: errorMessage(error) });
    }
  }

  private isCurrentFileRequest(request: FileRequestIdentity): boolean {
    const state = this.getState();
    return request.generation === this.fileRequestGeneration
      && state.selectedFilePath === request.path
      && state.selectedProject?.id === request.projectId
      && state.selectedWorkspace?.id === request.workspaceId
      && selectedMachineId(state) === request.machineId;
  }

  async createFile(path: string): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined || path === "") return;
    const request = { projectId: project.id, workspaceId: workspace.id, machineId: selectedMachineId(this.getState()) };
    try {
      await this.api.createWorkspaceFile(project.id, workspace.id, path, request.machineId);
      if (!this.isCurrentWorkspace(request)) return;
      await this.refreshParents([path]);
      if (!this.isCurrentWorkspace(request)) return;
      await this.selectFile(path);
      this.setState({ error: "" });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async createDirectory(path: string): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined || path === "") return;
    const request = { projectId: project.id, workspaceId: workspace.id, machineId: selectedMachineId(this.getState()) };
    try {
      await this.api.createWorkspaceDirectory(project.id, workspace.id, path, request.machineId);
      if (!this.isCurrentWorkspace(request)) return;
      await this.refreshParents([path]);
      if (!this.isCurrentWorkspace(request)) return;
      this.selectDirectory(path);
      this.setState({ error: "" });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async moveSelectedPath(toPath: string): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    const fromPath = this.getState().selectedFilePath;
    if (project === undefined || workspace === undefined || fromPath === undefined || fromPath === "" || toPath === "") return;
    const request = { projectId: project.id, workspaceId: workspace.id, machineId: selectedMachineId(this.getState()) };
    try {
      const machineId = selectedMachineId(this.getState());
      if (selectedPathKind(this.getState()) === "directory") {
        await this.api.moveWorkspaceDirectory(project.id, workspace.id, fromPath, toPath, machineId);
        if (!this.isCurrentWorkspace(request)) return;
        this.removeExpandedSubtree(fromPath);
        await this.refreshParents([fromPath, toPath]);
        if (!this.isCurrentWorkspace(request)) return;
        this.selectDirectory(toPath);
      } else {
        await this.api.moveWorkspaceFile(project.id, workspace.id, fromPath, toPath, undefined, machineId);
        if (!this.isCurrentWorkspace(request)) return;
        await this.refreshParents([fromPath, toPath]);
        if (!this.isCurrentWorkspace(request)) return;
        await this.selectFile(toPath);
      }
      this.setState({ error: "" });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async deleteSelectedPath(): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    const path = this.getState().selectedFilePath;
    if (project === undefined || workspace === undefined || path === undefined || path === "") return;
    const request = { projectId: project.id, workspaceId: workspace.id, machineId: selectedMachineId(this.getState()) };
    try {
      const machineId = selectedMachineId(this.getState());
      if (selectedPathKind(this.getState()) === "directory") await this.api.deleteWorkspaceDirectory(project.id, workspace.id, path, machineId);
      else await this.api.deleteWorkspaceFile(project.id, workspace.id, path, machineId);
      if (!this.isCurrentWorkspace(request)) return;
      this.removeExpandedSubtree(path);
      await this.refreshParents([path]);
      if (!this.isCurrentWorkspace(request)) return;
      this.clearSelection();
      this.setState({ error: "" });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async downloadSelectedFile(): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    const path = this.getState().selectedFilePath;
    if (project === undefined || workspace === undefined || path === undefined || path === "" || selectedPathKind(this.getState()) === "directory") return;
    try {
      await this.api.downloadWorkspaceFile(project.id, workspace.id, path, selectedMachineId(this.getState()));
      this.setState({ error: "" });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  private clearSelection(): void {
    this.fileRequestGeneration += 1;
    this.setState({ selectedFilePath: undefined, selectedFileContent: undefined, selectedFileLoadError: undefined });
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", undefined, { replace: true });
    this.updateUrl({ replace: true });
  }

  startWorkspaceUpload(files: readonly File[], options: StartWorkspaceUploadOptions): WorkspaceUploadRun | undefined {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined) {
      this.setState({ error: "上传文件前请选择工作区。" });
      return undefined;
    }
    if (files.length === 0) return undefined;

    const machineId = selectedMachineId(this.getState());
    const overwrite = options.overwrite ?? false;
    const createDirs = options.createDirs ?? true;
    let batch: WorkspaceUploadBatchState;
    try {
      batch = createWorkspaceUploadBatchState({
        id: this.createUploadBatchId(),
        projectId: project.id,
        workspaceId: workspace.id,
        machineId,
        destinationFolder: options.destinationFolder,
        overwrite,
        createDirs,
        files,
        startedAt: this.now(),
      });
    } catch (error) {
      this.setState({ error: String(error) });
      return undefined;
    }

    this.setUploadBatch(batch);
    let task: WorkspaceUploadTask<WriteWorkspaceFileResponse[]>;
    try {
      task = this.uploadWorkspaceFiles(project.id, workspace.id, files, {
        destinationFolder: options.destinationFolder,
        machineId,
        overwrite,
        createDirs,
        onProgress: (progress) => { this.updateUploadProgress(batch.id, progress); },
      });
    } catch (error) {
      this.failUploadBatch(batch.id, error);
      return { batchId: batch.id, done: Promise.resolve() };
    }

    this.uploadTasks.set(batch.id, task);
    const done = task.promise
      .then(async (responses) => { await this.completeUploadBatch(batch.id, responses, options); })
      .catch(async (error: unknown) => { await this.handleUploadFailure(batch.id, error, options); })
      .finally(() => { this.uploadTasks.delete(batch.id); });
    return { batchId: batch.id, done };
  }

  cancelWorkspaceUpload(batchId: string): void {
    const batch = this.getUploadBatch(batchId);
    if (batch?.status !== "uploading") return;
    this.setUploadBatch(cancelWorkspaceUploadBatch(batch, this.now()));
    this.uploadTasks.get(batchId)?.cancel();
  }

  clearWorkspaceUpload(batchId: string): void {
    this.uploadTasks.get(batchId)?.cancel();
    this.uploadTasks.delete(batchId);
    this.setState({ workspaceUploadBatches: omitKey(this.getState().workspaceUploadBatches, batchId) });
  }

  private updateUploadProgress(batchId: string, progress: WorkspaceUploadBatchProgress): void {
    const batch = this.getUploadBatch(batchId);
    if (batch?.status !== "uploading") return;
    this.setUploadBatch(updateWorkspaceUploadBatchProgress(batch, progress));
  }

  private async completeUploadBatch(batchId: string, responses: WriteWorkspaceFileResponse[], options: StartWorkspaceUploadOptions): Promise<void> {
    const batch = this.getUploadBatch(batchId);
    if (batch?.status !== "uploading") return;
    this.setUploadBatch(completeWorkspaceUploadBatch(batch, responses, this.now()), { error: "" });
    if (!this.isCurrentWorkspaceBatch(batch)) return;
    await this.refreshParents(responses.map((response) => response.path));
    const uploadedPath = responses[0]?.path;
    if (options.selectUploadedFile !== false && uploadedPath !== undefined && this.isCurrentWorkspaceBatch(batch)) await this.selectFile(uploadedPath);
  }

  private async handleUploadFailure(batchId: string, error: unknown, options: StartWorkspaceUploadOptions): Promise<void> {
    const batch = this.failUploadBatch(batchId, error);
    if (!(error instanceof WorkspaceUploadBatchError) || error.responses.length === 0 || batch === undefined || !this.isCurrentWorkspaceBatch(batch)) return;
    await this.refreshParents(error.responses.map((response) => response.path));
    const uploadedPath = error.responses[0]?.path;
    if (options.selectUploadedFile !== false && uploadedPath !== undefined && this.isCurrentWorkspaceBatch(batch)) await this.selectFile(uploadedPath);
  }

  private failUploadBatch(batchId: string, error: unknown): WorkspaceUploadBatchState | undefined {
    const batch = this.getUploadBatch(batchId);
    if (batch?.status !== "uploading") return undefined;
    if (isWorkspaceUploadCancelled(error)) {
      const cancelled = cancelWorkspaceUploadBatch(batch, this.now());
      this.setUploadBatch(cancelled);
      return cancelled;
    }
    const message = errorMessage(error);
    const failed = failWorkspaceUploadBatch(batch, message, this.now());
    this.setUploadBatch(failed, { error: message });
    return failed;
  }

  private getUploadBatch(batchId: string): WorkspaceUploadBatchState | undefined {
    return this.getState().workspaceUploadBatches[batchId];
  }

  private setUploadBatch(batch: WorkspaceUploadBatchState, patch: { error?: string } = {}): void {
    this.setState({ workspaceUploadBatches: { ...this.getState().workspaceUploadBatches, [batch.id]: batch }, ...patch });
  }

  private isCurrentWorkspaceBatch(batch: WorkspaceUploadBatchState): boolean {
    const state = this.getState();
    return state.selectedProject?.id === batch.projectId && state.selectedWorkspace?.id === batch.workspaceId && selectedMachineId(state) === batch.machineId;
  }
}

function isWorkspaceUploadCancelled(error: unknown): boolean {
  return error instanceof WorkspaceUploadCancelledError;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(0, Math.max(0, normalized.lastIndexOf("/")));
}

function omitKey<T>(record: Record<string, T>, keyToOmit: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToOmit));
}

function selectedPathKind(state: ReturnType<GetState>): "file" | "directory" {
  const path = state.selectedFilePath;
  if (path === undefined) return "file";
  return findFileTreeEntry(state.fileTree, state.expandedDirs, path)?.type === "directory" ? "directory" : "file";
}

function findFileTreeEntry(rootEntries: ReturnType<GetState>["fileTree"], expandedDirs: ReturnType<GetState>["expandedDirs"], path: string) {
  const rootMatch = rootEntries.find((entry) => entry.path === path);
  if (rootMatch !== undefined) return rootMatch;
  for (const entries of Object.values(expandedDirs)) {
    const match = entries.find((entry) => entry.path === path);
    if (match !== undefined) return match;
  }
  return undefined;
}

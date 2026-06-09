import { api as defaultApi } from "../api";
import { queryNamespace, setNamespacedQueryKey } from "../namespacedQueryArgs";
import { selectedMachineId, type GetState, type SetState, type UpdateUrl } from "./types";

const FILES_ROUTE_NAMESPACE = queryNamespace("core:workspace.files");

export class FileExplorerController {
  private readonly api: typeof defaultApi;

  constructor(private readonly getState: GetState, private readonly setState: SetState, private readonly updateUrl: UpdateUrl, deps: { api?: typeof defaultApi } = {}) {
    this.api = deps.api ?? defaultApi;
  }

  async refreshFiles(): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined) return;
    try {
      const machineId = selectedMachineId(this.getState());
      const root = await this.api.workspaceTree(project.id, workspace.id, "", machineId);
      const expandedEntries = await Promise.all(Object.keys(this.getState().expandedDirs).map(async (path) => {
        try {
          const response = await this.api.workspaceTree(project.id, workspace.id, path, machineId);
          return [path, response.entries] as const;
        } catch (error) {
          if (isUnavailableFileError(error)) return undefined;
          throw error;
        }
      }));
      const expanded = Object.fromEntries(expandedEntries.filter((entry) => entry !== undefined));
      this.setState({ fileTree: root.entries, expandedDirs: expanded, fileTreeStale: false, error: "" });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async expandDir(path: string): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined) return;
    if (this.getState().expandedDirs[path] !== undefined) {
      this.setState({ expandedDirs: omitKey(this.getState().expandedDirs, path) });
      return;
    }
    try {
      const response = await this.api.workspaceTree(project.id, workspace.id, path, selectedMachineId(this.getState()));
      this.setState({ expandedDirs: { ...this.getState().expandedDirs, [path]: response.entries }, error: "" });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async selectFile(path: string): Promise<void> {
    this.setState({ selectedFilePath: path, selectedFileContent: undefined, workspaceTool: "core:workspace.files", mainView: this.getState().mainView === "chat" ? "chat" : "core:workspace.files" });
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", path);
    this.updateUrl({ replace: true });
    await this.restoreFile(path);
  }

  selectDirectory(path: string): void {
    this.setState({ selectedFilePath: path, selectedFileContent: undefined, workspaceTool: "core:workspace.files", mainView: this.getState().mainView === "chat" ? "chat" : "core:workspace.files" });
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", undefined, { replace: true });
    this.updateUrl({ replace: true });
  }

  async restoreFile(path: string): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined) return;
    this.setState({ selectedFilePath: path, selectedFileContent: undefined });
    try {
      const content = await this.api.workspaceFile(project.id, workspace.id, path, selectedMachineId(this.getState()));
      if (this.getState().selectedFilePath === path) this.setState({ selectedFileContent: content, error: "" });
    } catch (error) {
      if (this.getState().selectedFilePath !== path) return;
      if (isUnavailableFileError(error)) {
        this.setState({ selectedFilePath: undefined, selectedFileContent: undefined, error: "" });
        setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", undefined, { replace: true });
        this.updateUrl({ replace: true });
        return;
      }
      this.setState({ error: String(error) });
    }
  }

  async uploadFiles(files: readonly File[]): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined || files.length === 0) return;
    try {
      const machineId = selectedMachineId(this.getState());
      const uploadDir = selectedUploadDirectory(this.getState());
      const uploadedPaths: string[] = [];
      for (const file of files) {
        const path = joinWorkspacePath(uploadDir, uploadFileName(file));
        await this.api.uploadWorkspaceFile(project.id, workspace.id, path, file, machineId);
        uploadedPaths.push(path);
      }
      await this.refreshFiles();
      const lastPath = uploadedPaths.at(-1);
      if (lastPath !== undefined) await this.selectFile(lastPath);
      this.setState({ error: "" });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async createFile(path: string): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined || path === "") return;
    try {
      await this.api.createWorkspaceFile(project.id, workspace.id, path, selectedMachineId(this.getState()));
      await this.refreshFiles();
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
    try {
      await this.api.createWorkspaceDirectory(project.id, workspace.id, path, selectedMachineId(this.getState()));
      await this.refreshFiles();
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
    try {
      const machineId = selectedMachineId(this.getState());
      if (selectedPathKind(this.getState()) === "directory") {
        await this.api.moveWorkspaceDirectory(project.id, workspace.id, fromPath, toPath, machineId);
        await this.refreshFiles();
        this.selectDirectory(toPath);
      } else {
        await this.api.moveWorkspaceFile(project.id, workspace.id, fromPath, toPath, machineId);
        await this.refreshFiles();
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
    try {
      const machineId = selectedMachineId(this.getState());
      if (selectedPathKind(this.getState()) === "directory") await this.api.deleteWorkspaceDirectory(project.id, workspace.id, path, machineId);
      else await this.api.deleteWorkspaceFile(project.id, workspace.id, path, machineId);
      await this.refreshFiles();
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
    this.setState({ selectedFilePath: undefined, selectedFileContent: undefined });
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", undefined, { replace: true });
    this.updateUrl({ replace: true });
  }
}

function isUnavailableFileError(error: unknown): boolean {
  const message = String(error);
  return message.includes("Path does not exist") || message.includes("ENOENT") || message.includes("no such file or directory");
}

function omitKey<T>(record: Record<string, T>, keyToOmit: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToOmit));
}

function selectedUploadDirectory(state: ReturnType<GetState>): string {
  const path = state.selectedFilePath;
  if (path === undefined || path === "") return "";
  const entry = findFileTreeEntry(state.fileTree, state.expandedDirs, path);
  if (entry?.type === "directory") return path;
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
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

function uploadFileName(file: File): string {
  return file.name.split(/[\\/]+/u).filter((part) => part !== "").at(-1) ?? file.name;
}

function joinWorkspacePath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

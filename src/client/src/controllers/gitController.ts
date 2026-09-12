import { api } from "../api";
import { queryNamespace, setNamespacedQueryKey } from "../namespacedQueryArgs";
import { selectedMachineId, type GetState, type SetState, type UpdateUrl } from "./types";

const GIT_ROUTE_NAMESPACE = queryNamespace("core:workspace.git");
const GIT_POLL_INTERVAL_MS = 8_000;
const LARGE_GIT_POLL_INTERVAL_MS = 30_000;
const LARGE_GIT_FILE_COUNT = 1_000;

export class GitController {
  private pollTimer: number | undefined;
  private pollDelay: number | undefined;
  private statusRequestGeneration = 0;
  private diffRequestGeneration = 0;
  private statusRequest: Promise<void> | undefined;
  private statusRefreshPending = false;
  private forceRefreshPending = false;
  private disposed = false;
  private visibilityDocument: Document | undefined;

  constructor(private readonly getState: GetState, private readonly setState: SetState, private readonly updateUrl: UpdateUrl) {}

  connect(): void {
    this.disposed = false;
    this.visibilityDocument = document;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  dispose(): void {
    this.disposed = true;
    this.statusRequestGeneration += 1;
    this.diffRequestGeneration += 1;
    this.stopPolling();
    this.visibilityDocument?.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.visibilityDocument = undefined;
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.pollDelay = undefined;
  }

  refreshGit(force = true): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.statusRefreshPending = true;
    this.forceRefreshPending ||= force;
    if (this.statusRequest !== undefined) return this.statusRequest;
    const request = this.runStatusRefreshLoop().finally(() => {
      if (this.statusRequest === request) this.statusRequest = undefined;
    });
    this.statusRequest = request;
    return request;
  }

  private async runStatusRefreshLoop(): Promise<void> {
    while (!this.disposed && this.consumeRefresh()) {
      const force = this.forceRefreshPending;
      this.forceRefreshPending = false;
      await this.refreshGitOnce(force);
    }
  }

  private consumeRefresh(): boolean {
    const pending = this.statusRefreshPending;
    this.statusRefreshPending = false;
    return pending;
  }

  private async refreshGitOnce(force: boolean): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined) return;
    const machineId = selectedMachineId(this.getState());
    const generation = ++this.statusRequestGeneration;
    const isCurrent = () => generation === this.statusRequestGeneration && this.isCurrentWorkspace(project.id, workspace.id, machineId);
    try {
      const status = await api.gitStatus(project.id, workspace.id, machineId, force);
      if (!isCurrent()) return;
      this.setState({ gitStatus: status, gitStale: false, error: "" });
      this.restartPollingWhenIntervalChanges();
      const selectedDiffPath = this.getState().selectedDiffPath;
      if (selectedDiffPath !== undefined) {
        if (status.files.some((file) => file.path === selectedDiffPath)) await this.refreshDiff(selectedDiffPath);
        else {
          this.setState({ selectedDiffPath: undefined, selectedDiff: undefined, selectedStagedDiff: undefined });
          setNamespacedQueryKey(GIT_ROUTE_NAMESPACE, "diff", undefined, { replace: true });
        }
      }
    } catch (error) {
      if (!isCurrent()) return;
      this.setState({ error: String(error) });
    }
  }

  async selectDiff(path: string): Promise<void> {
    this.setState({ selectedDiffPath: path, selectedDiff: undefined, selectedStagedDiff: undefined, workspaceTool: "core:workspace.git", mainView: this.getState().mainView === "chat" ? "chat" : "core:workspace.git" });
    setNamespacedQueryKey(GIT_ROUTE_NAMESPACE, "diff", path);
    this.updateUrl({ replace: true });
    await this.refreshDiff(path);
  }

  async restoreDiff(path: string): Promise<void> {
    this.setState({ selectedDiffPath: path, selectedDiff: undefined, selectedStagedDiff: undefined });
    await this.refreshDiff(path);
  }

  async refreshDiff(path: string): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined) return;
    const machineId = selectedMachineId(this.getState());
    const generation = ++this.diffRequestGeneration;
    const isCurrent = () => generation === this.diffRequestGeneration
      && this.isCurrentWorkspace(project.id, workspace.id, machineId)
      && this.getState().selectedDiffPath === path;
    try {
      const [selectedDiff, selectedStagedDiff] = await Promise.all([
        api.gitDiff(project.id, workspace.id, { path }, machineId),
        api.gitDiff(project.id, workspace.id, { path, staged: true }, machineId),
      ]);
      if (!isCurrent()) return;
      this.setState({ selectedDiff, selectedStagedDiff, error: "" });
    } catch (error) {
      if (!isCurrent()) return;
      this.setState({ error: String(error) });
    }
  }

  private isCurrentWorkspace(projectId: string, workspaceId: string, machineId: string): boolean {
    const state = this.getState();
    return state.selectedProject?.id === projectId && state.selectedWorkspace?.id === workspaceId
      && selectedMachineId(state) === machineId;
  }

  updatePolling(): void {
    this.stopPolling();
    const state = this.getState();
    if (!this.isGitSurfaceActive(state) || !this.isDocumentVisible()) return;
    const delay = (state.gitStatus?.files.length ?? 0) > LARGE_GIT_FILE_COUNT ? LARGE_GIT_POLL_INTERVAL_MS : GIT_POLL_INTERVAL_MS;
    this.pollDelay = delay;
    this.pollTimer = window.setInterval(() => {
      if (this.isDocumentVisible()) void this.refreshGit(false);
    }, delay);
  }

  private restartPollingWhenIntervalChanges(): void {
    if (this.pollTimer === undefined) return;
    const delay = (this.getState().gitStatus?.files.length ?? 0) > LARGE_GIT_FILE_COUNT ? LARGE_GIT_POLL_INTERVAL_MS : GIT_POLL_INTERVAL_MS;
    if (delay !== this.pollDelay) this.updatePolling();
  }

  private isGitSurfaceActive(state = this.getState()): boolean {
    return state.workspaceTool === "core:workspace.git" || state.mainView === "core:workspace.git";
  }

  private isDocumentVisible(): boolean {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }

  private readonly onVisibilityChange = () => {
    this.updatePolling();
    if (this.isDocumentVisible() && this.isGitSurfaceActive()) void this.refreshGit();
  };
}

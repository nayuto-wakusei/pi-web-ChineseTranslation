import { api } from "../api";
import { queryNamespace, setNamespacedQueryKey } from "../namespacedQueryArgs";
import { selectedMachineId, type GetState, type SetState, type UpdateUrl } from "./types";

const GIT_ROUTE_NAMESPACE = queryNamespace("core:workspace.git");

export class GitController {
  private pollTimer: number | undefined;
  private statusRequestGeneration = 0;
  private diffRequestGeneration = 0;

  constructor(private readonly getState: GetState, private readonly setState: SetState, private readonly updateUrl: UpdateUrl) {}

  dispose(): void {
    this.statusRequestGeneration += 1;
    this.diffRequestGeneration += 1;
    this.stopPolling();
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  async refreshGit(): Promise<void> {
    const project = this.getState().selectedProject;
    const workspace = this.getState().selectedWorkspace;
    if (project === undefined || workspace === undefined) return;
    const machineId = selectedMachineId(this.getState());
    const generation = ++this.statusRequestGeneration;
    const isCurrent = () => generation === this.statusRequestGeneration && this.isCurrentWorkspace(project.id, workspace.id, machineId);
    try {
      const status = await api.gitStatus(project.id, workspace.id, machineId);
      if (!isCurrent()) return;
      this.setState({ gitStatus: status, gitStale: false, error: "" });
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
    if (state.workspaceTool === "core:workspace.git" || state.mainView === "core:workspace.git") {
      this.pollTimer = window.setInterval(() => { void this.refreshGit(); }, 8000);
    }
  }
}

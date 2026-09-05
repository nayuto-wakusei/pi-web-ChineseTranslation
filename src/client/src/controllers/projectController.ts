import { api as defaultApi, type Project } from "../api";
import { BrowserErrorReporter, machineBrowserErrorScope, projectBrowserErrorScope } from "../browserErrors";
import { selectedMachineId, type GetState, type SetState } from "./types";
import type { WorkspaceController } from "./workspaceController";

export interface ProjectControllerDependencies {
  api?: Pick<typeof defaultApi, "projects" | "addProject" | "closeProject">;
  onProjectsApplied?: (machineId: string) => void;
}

export class ProjectController {
  private readonly api: Pick<typeof defaultApi, "projects" | "addProject" | "closeProject">;
  private readonly onProjectsApplied: ((machineId: string) => void) | undefined;
  private readonly browserErrors: BrowserErrorReporter;

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly workspaces: Pick<WorkspaceController, "selectProject" | "forgetProject" | "clearSelection">,
    deps: ProjectControllerDependencies = {},
  ) {
    this.api = deps.api ?? defaultApi;
    this.onProjectsApplied = deps.onProjectsApplied;
    this.browserErrors = new BrowserErrorReporter(getState, setState);
  }

  async loadProjects() {
    const machineId = selectedMachineId(this.getState());
    this.setState({ isLoadingProjects: true });
    try {
      const projects = await this.api.projects(machineId);
      if (selectedMachineId(this.getState()) !== machineId) return;
      const projectIds = new Set(projects.map((project) => project.id));
      const workspacesByProjectId = Object.fromEntries(Object.entries(this.getState().workspacesByProjectId).filter(([projectId]) => projectIds.has(projectId)));
      this.setState({ projects, workspacesByProjectId });
      this.onProjectsApplied?.(machineId);
    } catch (error) {
      this.browserErrors.report(machineBrowserErrorScope(machineId), String(error));
    } finally {
      if (selectedMachineId(this.getState()) === machineId) this.setState({ isLoadingProjects: false });
    }
  }

  async addProject(path: string, create?: boolean) {
    if (path.trim() === "") return;
    const machineId = selectedMachineId(this.getState());
    let project: Project;
    try {
      project = await this.api.addProject(path.trim(), undefined, create, machineId);
    } catch (error) {
      this.browserErrors.report(machineBrowserErrorScope(machineId), String(error));
      return;
    }
    if (selectedMachineId(this.getState()) !== machineId) return;
    try {
      const projects = this.getState().projects;
      this.setState({ projects: [...projects.filter((p) => p.id !== project.id), project], projectDialogOpen: false });
      this.onProjectsApplied?.(machineId);
      await this.workspaces.selectProject(project);
    } catch (error) {
      this.browserErrors.report(projectBrowserErrorScope(machineId, project.id), String(error));
    }
  }

  async closeProject(projectId: string) {
    const machineId = selectedMachineId(this.getState());
    try {
      await this.api.closeProject(projectId, machineId);
      if (selectedMachineId(this.getState()) !== machineId) return;
      this.workspaces.forgetProject(projectId);
      const state = this.getState();
      this.setState({ projects: state.projects.filter((p) => p.id !== projectId) });
      this.onProjectsApplied?.(machineId);
      if (state.selectedProject?.id === projectId) this.workspaces.clearSelection();
    } catch (error) {
      this.browserErrors.report(projectBrowserErrorScope(machineId, projectId), String(error));
    }
  }
}

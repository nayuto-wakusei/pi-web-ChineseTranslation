import { api as defaultApi, type Project } from "../api";
import { BrowserErrorReporter, machineBrowserErrorScope, projectBrowserErrorScope } from "../browserErrors";
import { selectedMachineId, type GetState, type NavigationDestinationOptions, type NavigationSelection, type SetState } from "./types";
import type { WorkspaceController } from "./workspaceController";

export interface ProjectTrustChoice {
  trusted: boolean;
  changed: boolean;
}

export interface ProjectControllerDependencies {
  api?: Pick<typeof defaultApi, "projects" | "addProject" | "closeProject"> & Partial<Pick<typeof defaultApi, "workspaces" | "setWorkspaceTrust">>;
  onProjectsApplied?: (machineId: string) => void;
  navigateToProject?: (project: Project | undefined, options?: NavigationDestinationOptions) => Promise<boolean>;
  captureNavigation?: () => NavigationSelection;
}

export class ProjectController {
  private readonly api: NonNullable<ProjectControllerDependencies["api"]>;
  private readonly onProjectsApplied: ((machineId: string) => void) | undefined;
  private readonly browserErrors: BrowserErrorReporter;
  private readonly navigateToProject: ProjectControllerDependencies["navigateToProject"];
  private readonly captureNavigation: ProjectControllerDependencies["captureNavigation"];

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly workspaces: Pick<WorkspaceController, "selectProject" | "forgetProject" | "clearSelection">,
    deps: ProjectControllerDependencies = {},
  ) {
    this.api = deps.api ?? defaultApi;
    this.onProjectsApplied = deps.onProjectsApplied;
    this.navigateToProject = deps.navigateToProject;
    this.captureNavigation = deps.captureNavigation;
    this.browserErrors = new BrowserErrorReporter(getState, setState);
  }

  readonly loadErrors = new Map<string, string>();

  async loadProjects() {
    const machineId = selectedMachineId(this.getState());
    this.loadErrors.delete(machineId);
    this.setState({ isLoadingProjects: true });
    try {
      const projects = await this.api.projects(machineId);
      if (selectedMachineId(this.getState()) !== machineId) return;
      const projectIds = new Set(projects.map((project) => project.id));
      const workspacesByProjectId = Object.fromEntries(Object.entries(this.getState().workspacesByProjectId).filter(([projectId]) => projectIds.has(projectId)));
      this.setState({ projects, workspacesByProjectId });
      this.onProjectsApplied?.(machineId);
    } catch (error) {
      this.loadErrors.set(machineId, String(error));
      this.browserErrors.report(machineBrowserErrorScope(machineId), String(error));
    } finally {
      if (selectedMachineId(this.getState()) === machineId) this.setState({ isLoadingProjects: false });
    }
  }

  async addProject(path: string, create?: boolean, trustChoice?: ProjectTrustChoice) {
    if (path.trim() === "") return;
    const machineId = selectedMachineId(this.getState());
    const expected = navigationSelection(this.getState(), this.captureNavigation);
    let project: Project;
    try {
      project = await this.api.addProject(path.trim(), undefined, create, machineId);
    } catch (error) {
      this.browserErrors.report(machineBrowserErrorScope(machineId), String(error));
      return;
    }
    try {
      if (selectedMachineId(this.getState()) === machineId) {
        const projects = this.getState().projects;
        this.setState({ projects: [...projects.filter((p) => p.id !== project.id), project], projectDialogOpen: false });
        this.onProjectsApplied?.(machineId);
      }
      if (trustChoice?.changed === true) {
        const workspaces = await (this.api.workspaces ?? defaultApi.workspaces)(project.id, machineId);
        const main = workspaces.find((workspace) => workspace.projectId === project.id && workspace.isMain);
        if (main === undefined) throw new Error(`无法保存项目 ${project.id} 的信任选择：主工作区不可用`);
        await (this.api.setWorkspaceTrust ?? defaultApi.setWorkspaceTrust)(project.id, main.id, trustChoice.trusted, machineId);
      }
      if (selectedMachineId(this.getState()) !== machineId) return;
      if (this.navigateToProject !== undefined) await this.navigateToProject(project, { expected });
      else await this.workspaces.selectProject(project);
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
      if (state.selectedProject?.id !== projectId) return;
      const expected = navigationSelection(this.getState(), this.captureNavigation);
      if (this.navigateToProject !== undefined) await this.navigateToProject(undefined, { expected });
      else this.workspaces.clearSelection();
    } catch (error) {
      this.browserErrors.report(projectBrowserErrorScope(machineId, projectId), String(error));
    }
  }
}

function navigationSelection(state: ReturnType<GetState>, captureNavigation?: () => NavigationSelection): NavigationSelection {
  return captureNavigation?.() ?? {
    machineId: selectedMachineId(state),
    projectId: state.selectedProject?.id,
    workspaceId: state.selectedWorkspace?.id,
    ...(state.selectedSession === undefined || Reflect.get(state.selectedSession, "clientPendingStart") !== true ? { sessionId: state.selectedSession?.id } : {}),
  };
}

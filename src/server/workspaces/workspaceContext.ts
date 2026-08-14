import type { ProjectService } from "../projects/projectService.js";
import type { Project } from "../types.js";
import type { WorkspaceListing } from "../../shared/apiTypes.js";
import { asWorkspaceCatalog, type WorkspaceCatalogInput, type WorkspaceCatalogRequestOptions } from "./workspaceCatalog.js";

export interface WorkspaceContext {
  project: Project;
  workspace: WorkspaceListing;
  root: string;
}

export async function resolveWorkspaceContext(projects: ProjectService, workspaces: WorkspaceCatalogInput, projectId: string, workspaceId: string): Promise<WorkspaceContext> {
  const project = await projects.requireProject(projectId);
  return resolveProjectWorkspaceContext(asWorkspaceCatalog(projects, workspaces), project, workspaceId);
}

export async function resolveProjectWorkspaceContext(workspaces: WorkspaceCatalogInput, project: Project, workspaceId: string, options: WorkspaceCatalogRequestOptions = {}): Promise<WorkspaceContext> {
  const catalog = asWorkspaceCatalog({ requireProject: () => Promise.resolve(project) }, workspaces);
  const workspace = await catalog.resolve(project.id, workspaceId, options);
  return { project, workspace, root: workspace.path };
}

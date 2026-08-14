import type { PiWebPathAccessConfig } from "../../shared/apiTypes.js";
import type { PiWebConfigService } from "../configRoutes.js";
import type { ProjectService } from "../projects/projectService.js";
import type { WorkspaceContext } from "./workspaceContext.js";
import { asWorkspaceCatalog, type WorkspaceCatalog, type WorkspaceCatalogInput } from "./workspaceCatalog.js";
import { cwdPathsEqual } from "../workingDirectory.js";
import { loadEffectiveProjectPathAccess } from "./projectPiWebConfig.js";

export async function pathAccessForWorkspaceContext(context: WorkspaceContext, config: Pick<PiWebConfigService, "read"> | undefined): Promise<PiWebPathAccessConfig | undefined> {
  if (config === undefined) return undefined;
  const response = await config.read();
  return loadEffectiveProjectPathAccess(context.project.path, response.effectiveConfig);
}

export async function pathAccessForCwd(cwd: string, projects: ProjectService, workspaces: WorkspaceCatalogInput, config: Pick<PiWebConfigService, "read"> | undefined): Promise<PiWebPathAccessConfig | undefined> {
  if (config === undefined) return undefined;
  const response = await config.read();
  const projectPath = await projectPathForWorkspaceCwd(cwd, projects, asWorkspaceCatalog(projects, workspaces));
  if (projectPath === undefined) return response.effectiveConfig.pathAccess;
  return loadEffectiveProjectPathAccess(projectPath, response.effectiveConfig);
}

async function projectPathForWorkspaceCwd(cwd: string, projects: ProjectService, workspaces: WorkspaceCatalog): Promise<string | undefined> {
  for (const project of await projects.list()) {
    if (cwdPathsEqual(project.path, cwd)) return project.path;
    if ((await workspaces.list(project.id)).some((workspace) => cwdPathsEqual(workspace.path, cwd))) return project.path;
  }
  return undefined;
}

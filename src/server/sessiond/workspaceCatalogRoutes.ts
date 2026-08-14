import type { FastifyInstance } from "fastify";
import type { Project } from "../types.js";
import type { WorkspaceProviderAuthorityResolution } from "../workspaces/workspaceProviderRegistry.js";
import type { WorkspaceProviderRuntimeSnapshot } from "../workspaces/workspaceCatalog.js";
import { sendWorkspaceRequestError } from "../workspaces/workspaceRouteErrors.js";
import { resolveSessiondProject, type SessiondProjectReader } from "./managementProjectResolver.js";

export interface WorkspaceCatalogResolver {
  resolve(project: Project): Promise<WorkspaceProviderAuthorityResolution>;
}

export interface WorkspaceCatalogRouteDependencies {
  projects: SessiondProjectReader;
  workspaces: WorkspaceCatalogResolver;
  providerRuntime: WorkspaceProviderRuntimeSnapshot;
  managementProjectRoot?: string | undefined;
}

/** Internal sessiond protocol; browser-facing routes consume it through a typed client. */
export function registerWorkspaceCatalogRoutes(
  app: FastifyInstance,
  dependencies: WorkspaceCatalogRouteDependencies,
  prefix = "/workspace-catalog",
): void {
  app.get(`${prefix}/provider-runtime`, () => dependencies.providerRuntime);

  app.get<{ Params: { projectId: string } }>(`${prefix}/projects/:projectId/workspaces`, async (request, reply) => {
    try {
      const project = await resolveSessiondProject(request.headers, request.params.projectId, dependencies);
      return await dependencies.workspaces.resolve(project);
    } catch (error) {
      return sendWorkspaceRequestError(reply, error, projectErrorStatus(error));
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId`, async (request, reply) => {
    try {
      const project = await resolveSessiondProject(request.headers, request.params.projectId, dependencies);
      const resolution = await dependencies.workspaces.resolve(project);
      const workspace = resolution.workspaces.find((candidate) => candidate.id === request.params.workspaceId);
      if (workspace === undefined) return await reply.code(404).send({ error: "Workspace not found" });
      return workspace;
    } catch (error) {
      return sendWorkspaceRequestError(reply, error, projectErrorStatus(error));
    }
  });
}

function projectErrorStatus(error: unknown): number {
  if (!(error instanceof Error)) return 500;
  if (error.message === "Project not found") return 404;
  if (error.message === "Project is not authorized for this management session") return 403;
  return 500;
}

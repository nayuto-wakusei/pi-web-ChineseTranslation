import type { FastifyInstance } from "fastify";
import type { ProjectService } from "./projects/projectService.js";
import type { WorkspaceService } from "./workspaces/workspaceService.js";
import { resolveRouteWorkspaceContext } from "./workspaces/workspaceRouteContext.js";
import { gitDiff, gitStatus } from "./git/gitService.js";
import type { ManagementEmbedRuntime } from "./managementEmbed.js";

export function registerGitRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, prefix = "/api", managementEmbed?: ManagementEmbedRuntime): void {
  app.get<{ Params: { projectId: string; workspaceId: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/git/status`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
      return await gitStatus(context.root);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string; staged?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/git/diff`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
      return await gitDiff(context.root, { ...(request.query.path === undefined ? {} : { path: request.query.path }), staged: request.query.staged === "true" });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

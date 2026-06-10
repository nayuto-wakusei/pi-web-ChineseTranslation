import type { FastifyInstance, FastifyReply } from "fastify";
import type { ProjectService } from "./projects/projectService.js";
import type { WorkspaceService } from "./workspaces/workspaceService.js";
import { resolveWorkspaceContext } from "./workspaces/workspaceContext.js";
import { gitDiff, gitStatus } from "./git/gitService.js";
import { managementContextForRequest, projectFromManagedEmbedContext, type ManagementEmbedRuntime } from "./managementEmbed.js";

export function registerGitRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, prefix = "/api", managementEmbed?: ManagementEmbedRuntime): void {
  app.get<{ Params: { projectId: string; workspaceId: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/git/status`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
      return await gitStatus(context.root);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string; staged?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/git/diff`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
      return await gitDiff(context.root, { ...(request.query.path === undefined ? {} : { path: request.query.path }), staged: request.query.staged === "true" });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function resolveRouteWorkspaceContext(
  projects: ProjectService,
  workspaces: WorkspaceService,
  managementEmbed: ManagementEmbedRuntime | undefined,
  request: Parameters<typeof managementContextForRequest>[0],
  reply: FastifyReply,
  projectId: string,
  workspaceId: string,
) {
  const managementContext = await managementContextForRequest(request, managementEmbed, reply);
  if (managementContext === undefined) return resolveWorkspaceContext(projects, workspaces, projectId, workspaceId);
  if (managementEmbed === undefined) throw new Error("Management embed mode is not configured");
  const project = await projectFromManagedEmbedContext(managementEmbed.projectRoot, managementContext, projectId);
  const workspace = (await workspaces.list(project)).find((candidate) => candidate.id === workspaceId);
  if (workspace === undefined) throw new Error("Workspace not found");
  return { project, workspace, root: workspace.path };
}

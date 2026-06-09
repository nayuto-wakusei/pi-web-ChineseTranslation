import type { FastifyInstance } from "fastify";
import type { ProjectService } from "./projects/projectService.js";
import type { WorkspaceService } from "./workspaces/workspaceService.js";
import { resolveWorkspaceContext } from "./workspaces/workspaceContext.js";
import { listWorkspaceTree } from "./workspaces/fileTreeService.js";
import { readWorkspaceFile } from "./workspaces/fileContentService.js";
import { readWorkspaceImagePreview } from "./workspaces/imagePreviewService.js";
import { managementContextForRequest, projectFromManagedEmbedContext, type ManagementEmbedRuntime } from "./managementEmbed.js";

export function registerWorkspaceExplorerRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, prefix = "/api", managementEmbed?: ManagementEmbedRuntime): void {
  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/tree`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, request.params.projectId, request.params.workspaceId);
      return await listWorkspaceTree(context.root, request.query.path);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, request.params.projectId, request.params.workspaceId);
      return await readWorkspaceFile(context.root, request.query.path);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file/preview`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, request.params.projectId, request.params.workspaceId);
      const preview = await readWorkspaceImagePreview(context.root, request.query.path);
      return await reply
        .type(preview.mimeType)
        .header("Cache-Control", "private, max-age=3600")
        .header("Content-Length", String(preview.size))
        .header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'")
        .header("Last-Modified", new Date(preview.modifiedAt).toUTCString())
        .header("X-Content-Type-Options", "nosniff")
        .send(preview.stream);
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
  projectId: string,
  workspaceId: string,
) {
  const managementContext = await managementContextForRequest(request, managementEmbed);
  if (managementContext === undefined) return resolveWorkspaceContext(projects, workspaces, projectId, workspaceId);
  if (managementEmbed === undefined) throw new Error("Management embed mode is not configured");
  const project = await projectFromManagedEmbedContext(managementEmbed.projectRoot, managementContext, projectId);
  const workspace = (await workspaces.list(project)).find((candidate) => candidate.id === workspaceId);
  if (workspace === undefined) throw new Error("Workspace not found");
  return { project, workspace, root: workspace.path };
}

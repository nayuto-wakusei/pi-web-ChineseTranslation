import type { FastifyInstance, FastifyReply } from "fastify";
import type { ProjectService } from "./projects/projectService.js";
import type { WorkspaceService } from "./workspaces/workspaceService.js";
import { resolveWorkspaceContext } from "./workspaces/workspaceContext.js";
import { listWorkspaceTree } from "./workspaces/fileTreeService.js";
import { readWorkspaceFile } from "./workspaces/fileContentService.js";
import { uploadWorkspaceFile, type WorkspaceUploadInput } from "./workspaces/fileUploadService.js";
import { createWorkspaceDirectory, deleteWorkspaceDirectory, deleteWorkspaceFile, moveWorkspaceDirectory, moveWorkspaceFile, readWorkspaceFileDownload, type WorkspaceMoveInput, type WorkspacePathInput } from "./workspaces/fileOperationService.js";
import { readWorkspaceImagePreview } from "./workspaces/imagePreviewService.js";
import { managementContextForRequest, projectFromManagedEmbedContext, type ManagementEmbedRuntime } from "./managementEmbed.js";

export function registerWorkspaceExplorerRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, prefix = "/api", managementEmbed?: ManagementEmbedRuntime): void {
  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/tree`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
      return await listWorkspaceTree(context.root, request.query.path);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
      return await readWorkspaceFile(context.root, request.query.path);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { projectId: string; workspaceId: string }; Body: WorkspaceUploadInput }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
      return await uploadWorkspaceFile(context.root, request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch<{ Params: { projectId: string; workspaceId: string }; Body: WorkspaceMoveInput }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
      return await moveWorkspaceFile(context.root, request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
      return await deleteWorkspaceFile(context.root, request.query.path);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file/download`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
      const download = await readWorkspaceFileDownload(context.root, request.query.path);
      return await reply
        .type("application/octet-stream")
        .header("Content-Length", String(download.size))
        .header("Content-Disposition", contentDispositionAttachment(download.filename))
        .header("Last-Modified", new Date(download.modifiedAt).toUTCString())
        .header("X-Content-Type-Options", "nosniff")
        .send(download.stream);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { projectId: string; workspaceId: string }; Body: WorkspacePathInput }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/directory`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
      return await createWorkspaceDirectory(context.root, request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch<{ Params: { projectId: string; workspaceId: string }; Body: WorkspaceMoveInput }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/directory`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
      return await moveWorkspaceDirectory(context.root, request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/directory`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
      return await deleteWorkspaceDirectory(context.root, request.query.path);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file/preview`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId);
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

function contentDispositionAttachment(filename: string): string {
  const fallback = filename
    .replace(/[^\x20-\x7E]/gu, "_")
    .replaceAll("\\", "_")
    .replaceAll("\"", "_");
  return `attachment; filename="${fallback === "" ? "download" : fallback}"; filename*=UTF-8''${encodeRFC5987Value(filename)}`;
}

function encodeRFC5987Value(value: string): string {
  return encodeURIComponent(value)
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("*", "%2A");
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

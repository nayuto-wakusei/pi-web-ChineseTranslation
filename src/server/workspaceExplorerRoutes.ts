import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MultipartValue } from "@fastify/multipart";
import type { WriteWorkspaceFileOptions } from "../shared/apiTypes.js";
import type { PiWebConfigService } from "./configRoutes.js";
import type { ProjectService } from "./projects/projectService.js";
import { deleteWorkspaceFile, moveWorkspaceFile, readWorkspaceFile, writeWorkspaceFile } from "./workspaces/fileContentService.js";
import { uploadWorkspaceFile, uploadWorkspaceFileStream, type WorkspaceUploadInput } from "./workspaces/fileUploadService.js";
import { createWorkspaceDirectory, deleteWorkspaceDirectory, moveWorkspaceDirectory, readWorkspaceFileDownload, type WorkspaceMoveInput, type WorkspacePathInput } from "./workspaces/fileOperationService.js";
import { isAbsoluteishFileSuggestionQuery, listFileSuggestions, listPathSuggestions } from "./workspaces/fileSuggestions.js";
import { listWorkspaceTree } from "./workspaces/fileTreeService.js";
import { readWorkspaceImagePreview } from "./workspaces/imagePreviewService.js";
import { resolveWorkspaceContext, type WorkspaceContext } from "./workspaces/workspaceContext.js";
import { pathAccessForWorkspaceContext } from "./workspaces/effectivePathAccess.js";
import { managementContextForRequest, projectFromManagedEmbedContext, type ManagementEmbedRuntime } from "./managementEmbed.js";
import type { WorkspaceService } from "./workspaces/workspaceService.js";

const WORKSPACE_UPLOAD_BODY_LIMIT_BYTES = 100 * 1024 * 1024;

export interface WorkspaceExplorerRouteOptions {
  config?: Pick<PiWebConfigService, "read">;
  managementEmbed?: ManagementEmbedRuntime | undefined;
}

export function registerWorkspaceExplorerRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, prefix = "/api", options: WorkspaceExplorerRouteOptions = {}): void {
  const managementEmbed = options.managementEmbed;
  registerWorkspaceFileContentParsers(app);

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/tree`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
      return await listWorkspaceTree(context.root, request.query.path, await pathAccessForWorkspaceContext(context, options.config));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
      return await readWorkspaceFile(context.root, request.query.path, await pathAccessForWorkspaceContext(context, options.config));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put<{ Params: { projectId: string; workspaceId: string }; Body: Buffer; Querystring: { path?: string; createDirs?: string; overwrite?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: true });
      const writeOptions: WriteWorkspaceFileOptions = {
        createDirs: request.query.createDirs !== "false",
        overwrite: request.query.overwrite !== "false",
      };
      return await writeWorkspaceFile(context.root, request.query.path, request.body, writeOptions);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { projectId: string; workspaceId: string }; Body: WorkspaceUploadInput }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, { bodyLimit: WORKSPACE_UPLOAD_BODY_LIMIT_BYTES }, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: true });
      if (request.isMultipart()) return await uploadWorkspaceFileFromMultipart(context.root, request);
      return await uploadWorkspaceFile(context.root, request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
      return await deleteWorkspaceFile(context.root, request.query.path);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { projectId: string; workspaceId: string }; Querystring: { fromPath?: string; toPath?: string; createDirs?: string; overwrite?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file/move`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: true });
      return await moveWorkspaceFile(context.root, request.query.fromPath, request.query.toPath, {
        createDirs: request.query.createDirs !== "false",
        overwrite: request.query.overwrite === "true",
      });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file/download`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
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
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: true });
      return await createWorkspaceDirectory(context.root, request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch<{ Params: { projectId: string; workspaceId: string }; Body: WorkspaceMoveInput }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/directory`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: true });
      return await moveWorkspaceDirectory(context.root, request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/directory`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
      return await deleteWorkspaceDirectory(context.root, request.query.path);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file/preview`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
      const preview = await readWorkspaceImagePreview(context.root, request.query.path, await pathAccessForWorkspaceContext(context, options.config));
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

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { q?: string; kind?: "tracked" | "untracked" | "other"; mode?: "file" | "path"; scope?: "tracked" | "all" } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/files`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
      const query = request.query.q ?? "";
      const pathAccess = isAbsoluteishFileSuggestionQuery(query) ? await pathAccessForWorkspaceContext(context, options.config) : undefined;
      if (request.query.mode === "path") return await listPathSuggestions(context.root, query, pathAccess);
      return await listFileSuggestions(context.root, query, { kind: request.query.kind, scope: request.query.scope, pathAccess });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function registerWorkspaceFileContentParsers(app: FastifyInstance): void {
  // Fastify's default parser only handles JSON; workspace file writes need to
  // accept text and arbitrary binary payloads. This route module is registered
  // for both local aliases, so parser registration must tolerate repeats.
  try { app.addContentTypeParser("text/plain", { parseAs: "string" }, (_request, body, done) => { done(null, Buffer.from(body)); }); } catch { /* already registered */ }
  try { app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => { done(null, body); }); } catch { /* already registered */ }
  try { app.addContentTypeParser(/^([a-z]+\/[a-z0-9.+-]+)$/u, { parseAs: "buffer" }, (_request, body, done) => { done(null, body); }); } catch { /* already registered */ }
}

async function uploadWorkspaceFileFromMultipart(rootPath: string, request: FastifyRequest) {
  const file = await request.file();
  if (file === undefined) throw new Error("Upload body must include path and file");
  const pathField = file.fields["path"];
  const value = Array.isArray(pathField) ? pathField[0] : pathField;
  const path = isMultipartStringField(value) ? value.value : undefined;
  return await uploadWorkspaceFileStream(rootPath, path, file.file);
}

function isMultipartStringField(value: unknown): value is MultipartValue<string> {
  return typeof value === "object"
    && value !== null
    && Reflect.get(value, "type") === "field"
    && typeof Reflect.get(value, "value") === "string";
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
  options: { createManagedProject: boolean },
): Promise<WorkspaceContext> {
  const managementContext = await managementContextForRequest(request, managementEmbed, reply);
  if (managementContext === undefined) return resolveWorkspaceContext(projects, workspaces, projectId, workspaceId);
  if (managementEmbed === undefined) throw new Error("Management embed mode is not configured");
  const project = await projectFromManagedEmbedContext(managementEmbed.projectRoot, managementContext, projectId, { create: options.createManagedProject });
  const workspace = (await workspaces.list(project)).find((candidate) => candidate.id === workspaceId);
  if (workspace === undefined) throw new Error("Workspace not found");
  return { project, workspace, root: workspace.path };
}

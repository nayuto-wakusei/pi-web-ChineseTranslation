import type { FastifyInstance } from "fastify";
import type { WriteWorkspaceFileOptions } from "../shared/apiTypes.js";
import type { PiWebConfigService } from "./configRoutes.js";
import type { ProjectService } from "./projects/projectService.js";
import { deleteWorkspaceFile, moveWorkspaceFile, readWorkspaceFile, writeWorkspaceFile } from "./workspaces/fileContentService.js";
import { createWorkspaceDirectory, deleteWorkspaceDirectory, moveWorkspaceDirectory, readWorkspaceFileDownload, type WorkspaceMoveInput, type WorkspacePathInput } from "./workspaces/fileOperationService.js";
import { isAbsoluteishFileSuggestionQuery, listFileSuggestions, listPathSuggestions } from "./workspaces/fileSuggestions.js";
import { listWorkspaceTree } from "./workspaces/fileTreeService.js";
import { readWorkspaceFilePreview } from "./workspaces/filePreviewService.js";
import { applyWorkspaceFilePreviewErrorResponsePolicy, applyWorkspaceFilePreviewResponsePolicy } from "./workspaces/filePreviewResponseHeaders.js";
import { workspaceFilePreviewResponsePolicy } from "./workspaces/filePreviewResponsePolicy.js";
import { resolveRouteWorkspaceContext } from "./workspaces/workspaceRouteContext.js";
import { pathAccessForWorkspaceContext } from "./workspaces/effectivePathAccess.js";
import type { ManagementEmbedRuntime } from "./managementEmbed.js";
import type { WorkspaceCatalogInput } from "./workspaces/workspaceCatalog.js";

export interface WorkspaceExplorerRouteOptions {
  config?: Pick<PiWebConfigService, "read">;
  managementEmbed?: ManagementEmbedRuntime | undefined;
}

export function registerWorkspaceExplorerRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceCatalogInput, prefix = "/api", options: WorkspaceExplorerRouteOptions = {}): void {
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

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string; optional?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
      return await readWorkspaceFile(context.root, request.query.path, await pathAccessForWorkspaceContext(context, options.config));
    } catch (error) {
      if (isMissingPathError(error)) {
        if (request.query.optional === "true") return reply.code(204).send();
        return reply.code(404).send({ error: error.message });
      }
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
      const download = await readWorkspaceFileDownload(context.root, request.query.path, await pathAccessForWorkspaceContext(context, options.config));
      applyWorkspaceFilePreviewResponsePolicy(reply, workspaceFilePreviewResponsePolicy(download.path, { download: true }));
      return await reply
        .header("Content-Length", String(download.size))
        .header("Last-Modified", new Date(download.modifiedAt).toUTCString())
        .send(download.body);
    } catch (error) {
      applyWorkspaceFilePreviewErrorResponsePolicy(reply);
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

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string; download?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file/preview`, async (request, reply) => {
    try {
      const context = await resolveRouteWorkspaceContext(projects, workspaces, managementEmbed, request, reply, request.params.projectId, request.params.workspaceId, { createManagedProject: false });
      const download = request.query.download === "1" || request.query.download === "true";
      const preview = await readWorkspaceFilePreview(context.root, request.query.path, await pathAccessForWorkspaceContext(context, options.config), { download });
      applyWorkspaceFilePreviewResponsePolicy(reply, workspaceFilePreviewResponsePolicy(preview.path, { download }));
      return await reply
        .header("Cache-Control", "private, max-age=3600")
        .header("Content-Length", String(preview.size))
        .header("Last-Modified", new Date(preview.modifiedAt).toUTCString())
        .send(preview.body);
    } catch (error) {
      applyWorkspaceFilePreviewErrorResponsePolicy(reply);
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

function isMissingPathError(error: unknown): error is Error {
  return error instanceof Error && error.message === "Path does not exist";
}

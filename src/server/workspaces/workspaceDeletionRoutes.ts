import type { FastifyInstance, FastifyReply } from "fastify";
import {
  parseWorkspaceRemovalRequest,
  WORKSPACE_REMOVAL_REQUEST_BODY_MAX_BYTES,
} from "../../shared/workspaceRemovalProtocol.js";
import { workspaceDeletionMetadata } from "../../shared/workspaceDeletion.js";
import { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import { requestCancellation } from "../requestCancellation.js";
import type { SessionProxyDaemon } from "../sessiond/sessionProxyRoutes.js";
import type { ProjectService } from "../projects/projectService.js";
import type { WorkspaceService } from "./workspaceService.js";
import { encodeManagementContext, managementContextForRequest, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";

/** Browser-facing adapter; sessiond owns all workspace removal decisions and effects. */
export function registerWorkspaceDeletionRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, daemon: SessionProxyDaemon, prefix?: string, managementEmbed?: ManagementEmbedRuntime): void;
export function registerWorkspaceDeletionRoutes(app: FastifyInstance, daemon: SessionProxyDaemon, prefix?: string, managementEmbed?: ManagementEmbedRuntime): void;
export function registerWorkspaceDeletionRoutes(
  app: FastifyInstance,
  daemon: SessionProxyDaemon | ProjectService = new SessionDaemonClient(),
  prefixOrWorkspaces: string | WorkspaceService = "/api",
  managementEmbedOrDaemon?: ManagementEmbedRuntime | SessionProxyDaemon,
  legacyPrefix = "/api",
  legacyManagementEmbed?: ManagementEmbedRuntime,
): void {
  const legacy = typeof prefixOrWorkspaces !== "string";
  const sessionDaemon: SessionProxyDaemon = legacy
    ? (managementEmbedOrDaemon !== undefined && "request" in managementEmbedOrDaemon ? managementEmbedOrDaemon : new SessionDaemonClient())
    : ("request" in daemon ? daemon : new SessionDaemonClient());
  const prefix = legacy ? legacyPrefix : prefixOrWorkspaces;
  const managementEmbed = legacy ? legacyManagementEmbed : isSessionDaemon(managementEmbedOrDaemon) ? undefined : managementEmbedOrDaemon;
  if (legacy) {
    if (!isProjectService(daemon) || !isWorkspaceService(prefixOrWorkspaces)) throw new Error("Invalid legacy workspace deletion dependencies");
    registerLegacyWorkspaceDeletionRoutes(app, daemon, prefixOrWorkspaces, sessionDaemon, prefix, managementEmbed);
    return;
  }
  app.delete<{ Params: { projectId: string; workspaceId: string }; Body: unknown }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId`,
    { bodyLimit: WORKSPACE_REMOVAL_REQUEST_BODY_MAX_BYTES },
    async (request, reply) => {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      let body: ReturnType<typeof parseWorkspaceRemovalRequest>;
      try {
        body = parseWorkspaceRemovalRequest(request.body);
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }

      const cancellation = requestCancellation(request, reply);
      try {
        const upstream = await sessionDaemon.request(
          "DELETE",
          `/workspace-removals/projects/${encodeURIComponent(request.params.projectId)}/workspaces/${encodeURIComponent(request.params.workspaceId)}`,
          body,
          managementHeaders(managementContext),
        );
        return await proxyJsonResponse(reply, upstream);
      } catch (error) {
        return await reply.code(502).send({
          error: `Session daemon unavailable: ${errorMessage(error)}`,
        });
      } finally {
        cancellation.dispose();
      }
    },
  );
}

function managementHeaders(context: ManagementEmbedContext | undefined): Record<string, string> | undefined {
  return context === undefined ? undefined : { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) };
}

function proxyJsonResponse(
  reply: FastifyReply,
  upstream: { statusCode: number; headers: Record<string, string>; body: string },
): unknown {
  reply.code(upstream.statusCode);
  const contentType = upstream.headers["content-type"];
  if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
  if (upstream.body === "") return undefined;
  try {
    const value: unknown = JSON.parse(upstream.body);
    return value;
  } catch (error) {
    return reply.code(502).send({
      error: `Invalid session daemon workspace removal response: ${errorMessage(error)}`,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSessionDaemon(value: ManagementEmbedRuntime | SessionProxyDaemon | undefined): value is SessionProxyDaemon {
  return value !== undefined && "request" in value;
}

function isProjectService(value: SessionProxyDaemon | ProjectService): value is ProjectService {
  return "requireProject" in value;
}

function isWorkspaceService(value: string | WorkspaceService): value is WorkspaceService {
  return typeof value !== "string" && "list" in value;
}

function registerLegacyWorkspaceDeletionRoutes(
  app: FastifyInstance,
  projects: ProjectService,
  workspaces: WorkspaceService,
  daemon: SessionProxyDaemon,
  prefix: string,
  managementEmbed: ManagementEmbedRuntime | undefined,
): void {
  app.delete<{ Params: { projectId: string; workspaceId: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId`, async (request, reply) => {
    try {
      const context = await managementContextForRequest(request, managementEmbed, reply);
      const project = context === undefined ? await projects.requireProject(request.params.projectId) : await projects.requireProject(request.params.projectId);
      const listed = await workspaces.list(project);
      const target = listed.find((workspace) => workspace.id === request.params.workspaceId);
      if (target === undefined) throw new Error("Workspace not found");
      if (!target.isGitWorktree || target.isMain) throw new Error("Only secondary Git worktrees can be deleted");
      const commandWorkspace = listed.find((workspace) => workspace.isMain) ?? listed.find((workspace) => workspace.id !== target.id);
      if (commandWorkspace === undefined) throw new Error("Project main workspace not found");
      const closed = await daemon.request("DELETE", `/terminals?cwd=${encodeURIComponent(target.path)}`, undefined, managementHeaders(context));
      if (closed.statusCode < 200 || closed.statusCode >= 300) throw new Error(`Failed to close workspace terminals: ${responseError(closed.body, closed.statusCode)}`);
      const started = await daemon.request("POST", "/terminal-command-runs", {
        origin: "core",
        projectId: project.id,
        workspaceId: commandWorkspace.id,
        cwd: commandWorkspace.path,
        title: `Delete workspace: ${target.branch ?? target.label}`,
        command: `git worktree remove ${shellQuote(target.path)}`,
        metadata: workspaceDeletionMetadata(target),
      }, managementHeaders(context));
      if (started.statusCode < 200 || started.statusCode >= 300) throw new Error(`Failed to start workspace deletion: ${responseError(started.body, started.statusCode)}`);
      return await reply.code(started.statusCode).send(JSON.parse(started.body));
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
}

function responseError(body: string, statusCode: number): string {
  try {
    const value: unknown = JSON.parse(body);
    if (isRecord(value) && typeof value["error"] === "string") return value["error"];
  } catch { /* fall through */ }
  return `HTTP ${String(statusCode)}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

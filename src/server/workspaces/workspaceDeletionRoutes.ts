import type { FastifyInstance, FastifyReply } from "fastify";
import {
  parseWorkspaceRemovalRequest,
  WORKSPACE_REMOVAL_REQUEST_BODY_MAX_BYTES,
} from "../../shared/workspaceRemovalProtocol.js";
import { SessionDaemonClient, type SessionDaemonRequestClient } from "../../sessiond/sessionDaemonClient.js";
import { sessionDaemonProxyFailure } from "../../sessiond/sessionDaemonErrors.js";
import { requestCancellation } from "../requestCancellation.js";
import type { ProjectService } from "../projects/projectService.js";
import type { WorkspaceListAdapter as WorkspaceService } from "./workspaceCatalog.js";
import { managementContextForRequest, managementHeaders, managementToolAllowed, type ManagementEmbedRuntime } from "../managementEmbed.js";

/** Browser-facing adapter; sessiond owns all workspace removal decisions and effects. */
export function registerWorkspaceDeletionRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, daemon: SessionDaemonRequestClient, prefix?: string, managementEmbed?: ManagementEmbedRuntime): void;
export function registerWorkspaceDeletionRoutes(app: FastifyInstance, daemon: SessionDaemonRequestClient, prefix?: string, managementEmbed?: ManagementEmbedRuntime): void;
export function registerWorkspaceDeletionRoutes(
  app: FastifyInstance,
  daemon: SessionDaemonRequestClient | ProjectService = new SessionDaemonClient(),
  prefixOrWorkspaces: string | WorkspaceService = "/api",
  managementEmbedOrDaemon?: ManagementEmbedRuntime | SessionDaemonRequestClient,
  legacyPrefix = "/api",
  legacyManagementEmbed?: ManagementEmbedRuntime,
): void {
  const legacy = typeof prefixOrWorkspaces !== "string";
  const sessionDaemon: SessionDaemonRequestClient = legacy
    ? (managementEmbedOrDaemon !== undefined && "request" in managementEmbedOrDaemon ? managementEmbedOrDaemon : new SessionDaemonClient())
    : ("request" in daemon ? daemon : new SessionDaemonClient());
  const prefix = legacy ? legacyPrefix : prefixOrWorkspaces;
  const managementEmbed = legacy ? legacyManagementEmbed : isSessionDaemon(managementEmbedOrDaemon) ? undefined : managementEmbedOrDaemon;
  if (legacy) {
    if (!isProjectService(daemon) || !isWorkspaceService(prefixOrWorkspaces)) throw new Error("Invalid legacy workspace deletion dependencies");
  }
  app.delete<{ Params: { projectId: string; workspaceId: string }; Body: unknown }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId`,
    { bodyLimit: WORKSPACE_REMOVAL_REQUEST_BODY_MAX_BYTES },
    async (request, reply) => {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      if (managementContext !== undefined && !managementToolAllowed(managementContext, "terminal-command-runs")) {
        return reply.code(403).send({ error: "Terminal command runs are disabled in management embed mode" });
      }
      let body: ReturnType<typeof parseWorkspaceRemovalRequest>;
      try {
        body = parseWorkspaceRemovalRequest(request.body);
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }

      const cancellation = requestCancellation(request, reply);
      try {
        const path = `/workspace-removals/projects/${encodeURIComponent(request.params.projectId)}/workspaces/${encodeURIComponent(request.params.workspaceId)}`;
        const headers = managementHeaders(managementContext, managementEmbed);
        const upstream = headers === undefined
          ? await sessionDaemon.request("DELETE", path, body, { signal: cancellation.signal })
          : await sessionDaemon.request("DELETE", path, body, headers, cancellation.signal);
        return await proxyJsonResponse(reply, upstream);
      } catch (error) {
        const failure = sessionDaemonProxyFailure(error);
        return await reply.code(failure.statusCode).send({ error: failure.error });
      } finally {
        cancellation.dispose();
      }
    },
  );
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

function isSessionDaemon(value: ManagementEmbedRuntime | SessionDaemonRequestClient | undefined): value is SessionDaemonRequestClient {
  return value !== undefined && "request" in value;
}

function isProjectService(value: SessionDaemonRequestClient | ProjectService): value is ProjectService {
  return "requireProject" in value;
}

function isWorkspaceService(value: string | WorkspaceService): value is WorkspaceService {
  return typeof value !== "string" && "list" in value;
}

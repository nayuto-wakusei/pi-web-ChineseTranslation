import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SessionDaemonClient } from "../sessiond/sessionDaemonClient.js";
import { withRequestCancellation } from "./requestCancellation.js";
import type { SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";
import { resolveManagedWorkspaceContext } from "./workspaces/workspaceRouteContext.js";
import type { WorkspaceCatalogInput } from "./workspaces/workspaceCatalog.js";
import {
  managementHeaders,
  managementContextForRequest,
  managementToolAllowed,
  type ManagementEmbedContext,
  type ManagementEmbedRuntime,
} from "./managementEmbed.js";

export function registerManagementTerminalProxyRoutes(app: FastifyInstance, workspaces: WorkspaceCatalogInput, daemon: SessionProxyDaemon = new SessionDaemonClient(), prefix = "/api", managementEmbed?: ManagementEmbedRuntime): void {
  for (const path of ["/projects/:projectId/workspaces/:workspaceId/terminals", "/projects/:projectId/workspaces/:workspaceId/terminals/*"]) {
    app.route({ method: ["GET", "POST", "DELETE"], url: `${prefix}${path}`, handler: async (request, reply) => {
      const context = await managementContextForRequest(request, managementEmbed, reply);
      return reply.code(context === undefined ? 410 : 403).send({ error: context === undefined
        ? "Ordinary terminals use the bundled Terminal plugin peer"
        : "Interactive terminal is disabled in management embed mode" });
    } });
  }
  app.post<{ Params: { projectId: string; workspaceId: string }; Body: TerminalCommandRunRequest }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/terminal-command-runs`, async (request, reply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      if (managementContext === undefined) return await reply.code(410).send({ error: "Ordinary terminals use the bundled Terminal plugin peer" });
      if (managementContext.tools?.deny?.includes("terminal-command-runs") === true || !managementToolAllowed(managementContext, "terminal-command-runs")) return await reply.code(403).send({ error: "Terminal command runs are disabled in management embed mode" });
      const context = await resolveManagedWorkspaceContext(workspaces, managementEmbed, managementContext, request.params.projectId, request.params.workspaceId, { createManagedProject: true });
      return await proxyJson(daemon, "POST", "/terminal-command-runs", {
        origin: request.body.origin,
        projectId: request.params.projectId,
        workspaceId: request.params.workspaceId,
        cwd: context.root,
        title: request.body.title,
        command: request.body.command,
        metadata: request.body.metadata ?? {},
      }, request, reply, managementHeaders(managementContext, managementEmbed));
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.get<{ Querystring: TerminalCommandRunQuery }>(`${prefix}/terminal-command-runs`, async (request, reply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      if (managementContext === undefined) return await reply.code(410).send({ error: "Ordinary terminals use the bundled Terminal plugin peer" });
      if (managementContext.tools?.deny?.includes("terminal-command-runs") === true || !managementToolAllowed(managementContext, "terminal-command-runs")) return await reply.code(403).send({ error: "Terminal command runs are disabled in management embed mode" });
      const value = await proxyJson(daemon, "GET", `/terminal-command-runs${terminalCommandRunQuery(request.query)}`, undefined, request, reply, managementHeaders(managementContext, managementEmbed));
      return filterManagedCommandRuns(value, managementContext);
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.post<{ Params: { runId: string } }>(`${prefix}/terminal-command-runs/:runId/cancel`, async (request, reply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      if (managementContext === undefined) return await reply.code(410).send({ error: "Ordinary terminals use the bundled Terminal plugin peer" });
      if (managementContext.tools?.deny?.includes("terminal-command-runs") === true || !managementToolAllowed(managementContext, "terminal-command-runs")) return await reply.code(403).send({ error: "Terminal command runs are disabled in management embed mode" });
      return await proxyJson(daemon, "POST", `/terminal-command-runs/${encodeURIComponent(request.params.runId)}/cancel`, undefined, request, reply, managementHeaders(managementContext, managementEmbed));
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.get<{ Params: { runId: string } }>(`${prefix}/terminal-command-runs/:runId`, async (request, reply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      if (managementContext === undefined) return await reply.code(410).send({ error: "Ordinary terminals use the bundled Terminal plugin peer" });
      if (managementContext.tools?.deny?.includes("terminal-command-runs") === true || !managementToolAllowed(managementContext, "terminal-command-runs")) return await reply.code(403).send({ error: "Terminal command runs are disabled in management embed mode" });
      const value = await proxyJson(daemon, "GET", `/terminal-command-runs/${encodeURIComponent(request.params.runId)}`, undefined, request, reply, managementHeaders(managementContext, managementEmbed));
      if (!isManagedCommandRun(value, managementContext)) return await reply.code(404).send({ error: "Terminal command run not found" });
      return value;
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

}

interface TerminalCommandRunRequest {
  origin: string;
  title: string;
  command: string;
  metadata?: Record<string, string>;
}

interface TerminalCommandRunQuery {
  projectId?: string;
  workspaceId?: string;
  terminalId?: string;
  statuses?: string;
  metadata?: string;
}

function terminalCommandRunQuery(filter: TerminalCommandRunQuery): string {
  const params = new URLSearchParams();
  if (filter.projectId !== undefined) params.set("projectId", filter.projectId);
  if (filter.workspaceId !== undefined) params.set("workspaceId", filter.workspaceId);
  if (filter.terminalId !== undefined) params.set("terminalId", filter.terminalId);
  if (filter.statuses !== undefined) params.set("statuses", filter.statuses);
  if (filter.metadata !== undefined) params.set("metadata", filter.metadata);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

async function proxyJson(
  daemon: SessionProxyDaemon,
  method: string,
  path: string,
  body: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  headers?: Record<string, string>,
): Promise<unknown> {
  return await withRequestCancellation(request, reply, async (signal) => {
    const upstream = await daemon.request(method, path, body, headers, signal);
    reply.code(upstream.statusCode);
    const contentType = upstream.headers["content-type"];
    if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
    const value: unknown = upstream.body !== "" ? JSON.parse(upstream.body) : undefined;
    return value;
  });
}

function filterManagedCommandRuns(value: unknown, context: ManagementEmbedContext): unknown {
  return Array.isArray(value) ? value.filter((run) => isManagedCommandRun(run, context)) : value;
}

function isManagedCommandRun(value: unknown, context: ManagementEmbedContext): boolean {
  if (!isRecord(value) || typeof value["projectId"] !== "string") return false;
  return context.projects.some((project) => project.id === value["projectId"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestFailed(reply: FastifyReply, error: unknown): void {
  reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
}

import type { FastifyInstance, FastifyReply } from "fastify";
import type { ProjectService } from "./projects/projectService.js";
import { SessionDaemonClient } from "../sessiond/sessionDaemonClient.js";
import type { SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";
import { resolveWorkspaceContext } from "./workspaces/workspaceContext.js";
import { resolveManagedWorkspaceContext } from "./workspaces/workspaceRouteContext.js";
import type { WorkspaceCatalogInput } from "./workspaces/workspaceCatalog.js";
import { terminalSizeQuery } from "./terminals/terminalSize.js";
import { bridgeSockets } from "./webSocketBridge.js";
import {
  encodeManagementContext,
  managementContextForRequest,
  managementToolAllowed,
  MANAGEMENT_EMBED_CONTEXT_HEADER,
  type ManagementEmbedContext,
  type ManagementEmbedRuntime,
} from "./managementEmbed.js";

export function registerTerminalProxyRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceCatalogInput, daemon: SessionProxyDaemon = new SessionDaemonClient(), prefix = "/api", managementEmbed?: ManagementEmbedRuntime): void {
  app.get<{ Params: { projectId: string; workspaceId: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/terminals`, async (request, reply) => {
    try {
      if (await managementContextForRequest(request, managementEmbed, reply) !== undefined) return [];
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await proxyJson(daemon, "GET", `/terminals?cwd=${encodeURIComponent(context.root)}`, undefined, reply);
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.delete<{ Params: { projectId: string; workspaceId: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/terminals`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await proxyJson(daemon, "DELETE", `/terminals?cwd=${encodeURIComponent(context.root)}`, undefined, reply);
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.post<{ Params: { projectId: string; workspaceId: string }; Body: { name?: string; cols?: number; rows?: number } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/terminals`, async (request, reply) => {
    try {
      if (await managementContextForRequest(request, managementEmbed, reply) !== undefined) return await reply.code(403).send({ error: "Interactive terminal is disabled in management embed mode" });
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await proxyJson(daemon, "POST", "/terminals", { ...request.body, cwd: context.root }, reply);
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.post<{ Params: { projectId: string; workspaceId: string; terminalId: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/terminals/:terminalId/continue`, async (request, reply) => {
    try {
      if (await managementContextForRequest(request, managementEmbed, reply) !== undefined) return await reply.code(403).send({ error: "Interactive terminal is disabled in management embed mode" });
      await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await proxyJson(daemon, "POST", `/terminals/${encodeURIComponent(request.params.terminalId)}/continue`, undefined, reply);
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.delete<{ Params: { projectId: string; workspaceId: string; terminalId: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/terminals/:terminalId`, async (request, reply) => {
    try {
      if (await managementContextForRequest(request, managementEmbed, reply) !== undefined) return await reply.code(403).send({ error: "Interactive terminal is disabled in management embed mode" });
      await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await proxyJson(daemon, "DELETE", `/terminals/${encodeURIComponent(request.params.terminalId)}`, undefined, reply);
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.post<{ Params: { projectId: string; workspaceId: string }; Body: TerminalCommandRunRequest }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/terminal-command-runs`, async (request, reply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      if (managementContext !== undefined && !managementToolAllowed(managementContext, "terminal-command-runs")) return await reply.code(403).send({ error: "Terminal command runs are disabled in management embed mode" });
      const context = managementContext === undefined
        ? await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId)
        : await resolveManagedWorkspaceContext(workspaces, managementEmbed, managementContext, request.params.projectId, request.params.workspaceId, { createManagedProject: true });
      return await proxyJson(daemon, "POST", "/terminal-command-runs", {
        origin: request.body.origin,
        projectId: request.params.projectId,
        workspaceId: request.params.workspaceId,
        cwd: context.root,
        title: request.body.title,
        command: request.body.command,
        metadata: request.body.metadata ?? {},
      }, reply, managementHeaders(managementContext));
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.get<{ Querystring: TerminalCommandRunQuery }>(`${prefix}/terminal-command-runs`, async (request, reply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      const value = await proxyJson(daemon, "GET", `/terminal-command-runs${terminalCommandRunQuery(request.query)}`, undefined, reply, managementHeaders(managementContext));
      return managementContext === undefined ? value : filterManagedCommandRuns(value, managementContext);
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.post<{ Params: { runId: string } }>(`${prefix}/terminal-command-runs/:runId/cancel`, async (request, reply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      return await proxyJson(daemon, "POST", `/terminal-command-runs/${encodeURIComponent(request.params.runId)}/cancel`, undefined, reply, managementHeaders(managementContext));
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.get<{ Params: { runId: string } }>(`${prefix}/terminal-command-runs/:runId`, async (request, reply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      const value = await proxyJson(daemon, "GET", `/terminal-command-runs/${encodeURIComponent(request.params.runId)}`, undefined, reply, managementHeaders(managementContext));
      if (managementContext !== undefined && !isManagedCommandRun(value, managementContext)) return await reply.code(404).send({ error: "Terminal command run not found" });
      return value;
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string; terminalId: string }; Querystring: { cols?: string; rows?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/terminals/:terminalId/socket`, { websocket: true }, async (socket, request) => {
    try {
      if (await managementContextForRequest(request, managementEmbed) !== undefined) throw new Error("Interactive terminal is disabled in management embed mode");
      await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      const sizeQuery = terminalSizeQuery(request.query.cols, request.query.rows);
      bridgeSockets(socket, daemon.connectWebSocket(`/terminals/${request.params.terminalId}/socket${sizeQuery}`));
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }));
      socket.close();
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

async function proxyJson(daemon: SessionProxyDaemon, method: string, path: string, body: unknown, reply: FastifyReply, headers?: Record<string, string>): Promise<unknown> {
  const upstream = await daemon.request(method, path, body, headers);
  reply.code(upstream.statusCode);
  const contentType = upstream.headers["content-type"];
  if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
  const value: unknown = upstream.body !== "" ? JSON.parse(upstream.body) : undefined;
  return value;
}

function managementHeaders(context: ManagementEmbedContext | undefined): Record<string, string> | undefined {
  return context === undefined ? undefined : { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) };
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

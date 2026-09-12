import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { WebSocket, type RawData } from "ws";
import { normalizeRequestCwd } from "../workingDirectory.js";
import { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import { assertManagedCwd, managementContextForRequest, managementHeaders, managementProjectRoot, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";

export interface SessionProxyDaemon {
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>, signal?: AbortSignal): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
  connectWebSocket(path: string, headers?: Record<string, string>): WebSocket;
}

export type ManagementProjectCwdResolver = (projectId: string, context: ManagementEmbedContext) => Promise<readonly string[]>;
export type NormalProjectCwdResolver = () => Promise<readonly string[]>;

export function registerSessionProxyRoutes(app: FastifyInstance, daemon: SessionProxyDaemon = new SessionDaemonClient(), prefix = "/api", managementEmbed?: ManagementEmbedRuntime, resolveManagementProjectCwds?: ManagementProjectCwdResolver, resolveNormalProjectCwds?: NormalProjectCwdResolver): void {
  const proxy = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      const scoped = await sessionProjectScope(stripPrefix(request.url, prefix), request.method, request.body, managementContext, resolveManagementProjectCwds, resolveNormalProjectCwds);
      const daemonPath = scoped.url;
      const body = scoped.handled ? scoped.body : await managementBody(daemonPath, scoped.body, managementContext, managementEmbed, request.method);
      const upstream = await daemon.request(request.method, daemonPath, body, managementHeaders(managementContext, managementEmbed));
      reply.code(upstream.statusCode);
      const contentType = upstream.headers["content-type"];
      if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
      return upstream.body !== "" ? parseJson(upstream.body) : undefined;
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  };

  app.get(`${prefix}/sessiond/health`, async (_request, reply) => {
    try {
      const upstream = await daemon.request("GET", "/health");
      reply.code(upstream.statusCode);
      const contentType = upstream.headers["content-type"];
      if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
      return upstream.body !== "" ? parseJson(upstream.body) : undefined;
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.get(`${prefix}/sessiond/runtime`, async (_request, reply) => {
    try {
      const upstream = await daemon.request("GET", "/runtime");
      reply.code(upstream.statusCode);
      const contentType = upstream.headers["content-type"];
      if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
      return upstream.body !== "" ? parseJson(upstream.body) : undefined;
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });

  app.get<{ Params: { sessionId: string } }>(`${prefix}/sessions/:sessionId/events`, { websocket: true }, (socket, request) => {
    void managementContextForRequest(request, managementEmbed).then(async (context) => {
      await managementBody(stripPrefix(request.url, prefix), undefined, context, managementEmbed);
      bridgeSockets(socket, daemon.connectWebSocket(stripPrefix(request.url, prefix), managementHeaders(context, managementEmbed)));
    }).catch((error: unknown) => {
      closeSocketWithError(socket, error);
    });
  });

  app.get(`${prefix}/sessions/events`, { websocket: true }, (socket, request) => {
    void managementContextForRequest(request, managementEmbed).then((context) => {
      bridgeSockets(socket, daemon.connectWebSocket("/sessions/events", managementHeaders(context, managementEmbed)));
    }).catch((error: unknown) => {
      closeSocketWithError(socket, error);
    });
  });

  app.get(`${prefix}/events`, { websocket: true }, (socket, request) => {
    void managementContextForRequest(request, managementEmbed).then((context) => {
      bridgeSockets(socket, daemon.connectWebSocket("/events", managementHeaders(context, managementEmbed)));
    }).catch((error: unknown) => {
      closeSocketWithError(socket, error);
    });
  });

  app.all(`${prefix}/activity`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/status`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/notices`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/notices/dismiss`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/auth`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/auth/*`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/sessions`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/sessions/*`, (request, reply) => proxy(request, reply));
}

async function managementBody(url: string, body: unknown, context: ManagementEmbedContext | undefined, managementEmbed: ManagementEmbedRuntime | undefined, method = "GET"): Promise<unknown> {
  if (context === undefined) return body;
  const parsed = new URL(url, "http://local");
  const routePath = parsed.pathname;
  if (routePath !== "/sessions" && !routePath.startsWith("/sessions/")) return body;
  for (const cwd of parsed.searchParams.getAll("cwd")) {
    await assertManagedCwd(managementProjectRoot(managementEmbed), context, cwd, { create: false });
  }
  if (isRecord(body) && Array.isArray(body["sessions"])) {
    for (const session of body["sessions"]) {
      if (isRecord(session) && typeof session["cwd"] === "string") {
        await assertManagedCwd(managementProjectRoot(managementEmbed), context, session["cwd"], { create: false });
      }
    }
  }
  if (isRecord(body) && typeof body["cwd"] === "string") {
    const cwd = await assertManagedCwd(managementProjectRoot(managementEmbed), context, body["cwd"], { create: routePath === "/sessions" && method === "POST" });
    return { ...body, cwd };
  }
  return body;
}

function stripPrefix(url: string, prefix: string): string {
  const path = url.split("?", 1)[0] ?? url;
  const query = url.slice(path.length);
  const stripped = path.startsWith(prefix) ? `${path.slice(prefix.length)}${query}` : url;
  return stripped === "" ? "/" : stripped;
}

function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function requestFailed(reply: FastifyReply, error: unknown): void {
  if (error instanceof SessionScopeError) {
    reply.code(error.statusCode).send({ error: error.message });
    return;
  }
  reply.code(502).send({ error: `Session daemon unavailable: ${error instanceof Error ? error.message : String(error)}` });
}

class SessionScopeError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

async function sessionProjectScope(url: string, method: string, body: unknown, context: ManagementEmbedContext | undefined, managed?: ManagementProjectCwdResolver, normal?: NormalProjectCwdResolver) {
  const parsed = new URL(url, "http://local");
  const cleanup = /^\/sessions\/cleanup(?:\/preview)?$/.test(parsed.pathname);
  const archive = /^\/sessions\/(?:bulk\/(?:archive|delete-archived)|[^/]+\/(?:archive|archive-tree|restore))$/.test(parsed.pathname)
    || (method === "DELETE" && /^\/sessions\/[^/]+$/.test(parsed.pathname));
  if (!cleanup && !archive) return { url, body, handled: false };
  const fields = isRecord(body) ? body : {};
  const bodyScope = fields["scopeProjectId"];
  const queryScopes = parsed.searchParams.getAll("scopeProjectId");
  const suppliedScope = bodyScope !== undefined ? bodyScope : queryScopes[0];
  if ((suppliedScope !== undefined && (typeof suppliedScope !== "string" || suppliedScope.trim() === "")) || queryScopes.some((scope) => scope !== suppliedScope)) throw new SessionScopeError(400, "Invalid project scope");
  let allowed: readonly string[];
  if (context !== undefined) {
    const projectId = cleanup ? fields["projectId"] : suppliedScope ?? (context.projects.length === 1 ? context.projects[0]?.id : undefined);
    if (typeof projectId !== "string" || projectId.trim() === "") throw new SessionScopeError(400, "Project scope is required");
    if (!context.projects.some((project) => project.id === projectId)) throw new SessionScopeError(400, "Unknown project scope");
    if (managed === undefined) throw new SessionScopeError(400, "Project scope resolver is unavailable");
    allowed = await managed(projectId, context);
  } else {
    if (suppliedScope !== undefined) throw new SessionScopeError(400, "scopeProjectId is only valid in management embed mode");
    if (normal === undefined) throw new SessionScopeError(400, "Project scope resolver is unavailable");
    allowed = await normal();
  }
  const allowedSet = new Set(allowed.map(normalizeRequestCwd));
  const validate = (value: unknown): string => {
    let cwd: string;
    try { cwd = normalizeRequestCwd(value); }
    catch (error) { throw new SessionScopeError(400, error instanceof Error ? error.message : String(error)); }
    if (!allowedSet.has(cwd)) throw new SessionScopeError(403, "Path is outside the selected project scope");
    return cwd;
  };
  const result = { ...fields };
  delete result["scopeProjectId"];
  parsed.searchParams.delete("scopeProjectId");
  if (cleanup) {
    const requested = fields["projectCwds"];
    if (requested !== undefined && (!Array.isArray(requested) || !requested.every((cwd) => typeof cwd === "string"))) throw new SessionScopeError(400, "projectCwds must be an array of strings");
    result["projectCwds"] = requested === undefined ? [...allowedSet] : [...new Set(requested.map(validate))];
  } else {
    const queryCwds = parsed.searchParams.getAll("cwd");
    queryCwds.forEach(validate);
    if (fields["cwd"] !== undefined) result["cwd"] = validate(fields["cwd"]);
    if (Array.isArray(fields["sessions"])) {
      result["sessions"] = fields["sessions"].map((session: unknown) => {
        if (!isRecord(session)) throw new SessionScopeError(400, "Invalid session reference");
        return { ...session, cwd: validate(session["cwd"]) };
      });
    } else if (queryCwds.length === 0 && fields["cwd"] === undefined) throw new SessionScopeError(400, "cwd is required");
  }
  return { url: `${parsed.pathname}${parsed.search}`, body: body === undefined && !cleanup ? undefined : result, handled: true };
}

function bridgeSockets(client: WebSocket, upstream: WebSocket): void {
  client.on("message", (data) => { sendIfOpen(upstream, data); });
  upstream.on("message", (data) => { sendIfOpen(client, data); });
  client.on("close", () => { upstream.close(); });
  upstream.on("close", () => { client.close(); });
  upstream.on("error", () => { client.close(); });
  client.on("error", () => { upstream.close(); });
}

function sendIfOpen(socket: WebSocket, data: RawData): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  }
}

function closeSocketWithError(socket: WebSocket, error: unknown): void {
  socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }));
  socket.close();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

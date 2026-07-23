import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { WebSocket, type RawData } from "ws";
import { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import { assertManagedCwd, encodeManagementContext, managementContextForRequest, managementProjectRoot, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";

export interface SessionProxyDaemon {
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
  connectWebSocket(path: string, headers?: Record<string, string>): WebSocket;
}

export type ManagementProjectCwdResolver = (projectId: string, context: ManagementEmbedContext) => Promise<readonly string[]>;

export function registerSessionProxyRoutes(app: FastifyInstance, daemon: SessionProxyDaemon = new SessionDaemonClient(), prefix = "/api", managementEmbed?: ManagementEmbedRuntime, resolveManagementProjectCwds?: ManagementProjectCwdResolver): void {
  const proxy = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      const daemonPath = stripPrefix(request.url, prefix);
      const body = await managementBody(daemonPath, request.body, managementContext, managementEmbed, resolveManagementProjectCwds);
      const upstream = await daemon.request(request.method, daemonPath, body, managementHeaders(managementContext));
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
    void managementContextForRequest(request, managementEmbed).then((context) => {
      bridgeSockets(socket, daemon.connectWebSocket(stripPrefix(request.url, prefix), managementHeaders(context)));
    }).catch((error: unknown) => {
      closeSocketWithError(socket, error);
    });
  });

  app.get(`${prefix}/sessions/events`, { websocket: true }, (socket, request) => {
    void managementContextForRequest(request, managementEmbed).then((context) => {
      bridgeSockets(socket, daemon.connectWebSocket("/sessions/events", managementHeaders(context)));
    }).catch((error: unknown) => {
      closeSocketWithError(socket, error);
    });
  });

  app.get(`${prefix}/events`, { websocket: true }, (socket, request) => {
    void managementContextForRequest(request, managementEmbed).then((context) => {
      bridgeSockets(socket, daemon.connectWebSocket("/events", managementHeaders(context)));
    }).catch((error: unknown) => {
      closeSocketWithError(socket, error);
    });
  });

  app.all(`${prefix}/activity`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/auth`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/auth/*`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/sessions`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/sessions/*`, (request, reply) => proxy(request, reply));
}

async function managementBody(url: string, body: unknown, context: ManagementEmbedContext | undefined, managementEmbed: ManagementEmbedRuntime | undefined, resolveManagementProjectCwds?: ManagementProjectCwdResolver): Promise<unknown> {
  if (context === undefined) return body;
  const path = url;
  const routePath = path.split("?", 1)[0] ?? path;
  if (routePath === "/sessions/cleanup/preview" || routePath === "/sessions/cleanup") {
    return await managementCleanupBody(body, context, managementEmbed, resolveManagementProjectCwds);
  }
  if (path.startsWith("/sessions?") || path.startsWith("/sessions/search?") || path.startsWith("/sessions/pins?") || /\/sessions\/[^/]+\/pin\?/u.test(path)) {
    const cwd = new URL(`http://local${path}`).searchParams.get("cwd");
    if (cwd !== null) await assertManagedCwd(managementProjectRoot(managementEmbed), context, cwd, { create: false });
    return body;
  }
  if (/\/sessions\/[^/]+\/pin$/u.test(path) && isRecord(body) && typeof body["cwd"] === "string") {
    return { ...body, cwd: await assertManagedCwd(managementProjectRoot(managementEmbed), context, body["cwd"], { create: false }) };
  }
  if (path === "/sessions" && isRecord(body) && typeof body["cwd"] === "string") {
    return { ...body, cwd: await assertManagedCwd(managementProjectRoot(managementEmbed), context, body["cwd"]) };
  }
  return body;
}

async function managementCleanupBody(body: unknown, context: ManagementEmbedContext, managementEmbed: ManagementEmbedRuntime | undefined, resolveManagementProjectCwds?: ManagementProjectCwdResolver): Promise<unknown> {
  if (!isRecord(body) || typeof body["projectId"] !== "string" || body["projectId"].trim() === "") {
    throw new Error("projectId field is required in management embed mode");
  }
  if (resolveManagementProjectCwds === undefined) throw new Error("Management cleanup project resolver is unavailable");

  const allowedCwds = [...new Set(await resolveManagementProjectCwds(body["projectId"], context))];
  const requestedCwds = stringArray(body["projectCwds"]) ?? allowedCwds;
  const allowedCwdSet = new Set(allowedCwds);
  for (const cwd of requestedCwds) {
    const validatedCwd = await assertManagedCwd(managementProjectRoot(managementEmbed), context, cwd, { create: false });
    if (!allowedCwdSet.has(validatedCwd)) throw new Error("Cleanup path is outside the selected managed project");
  }
  return { ...body, projectCwds: [...new Set(requestedCwds)] };
}

function managementHeaders(context: ManagementEmbedContext | undefined): Record<string, string> | undefined {
  return context === undefined ? undefined : { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) };
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
  reply.code(502).send({ error: `Session daemon unavailable: ${error instanceof Error ? error.message : String(error)}` });
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

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("projectCwds field must be an array of strings");
  return value;
}

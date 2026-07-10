import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { WebSocket, type RawData } from "ws";
import { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import { assertManagedCwd, encodeManagementContext, managementContextForRequest, managementProjectRoot, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";

export interface SessionProxyDaemon {
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
  connectWebSocket(path: string, headers?: Record<string, string>): WebSocket;
}

export function registerSessionProxyRoutes(app: FastifyInstance, daemon: SessionProxyDaemon = new SessionDaemonClient(), prefix = "/api", managementEmbed?: ManagementEmbedRuntime): void {
  const proxy = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      const body = await managementBody(request.url, request.body, managementContext, managementEmbed);
      const upstream = await daemon.request(request.method, stripPrefix(request.url, prefix), body, managementHeaders(managementContext));
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

async function managementBody(url: string, body: unknown, context: ManagementEmbedContext | undefined, managementEmbed: ManagementEmbedRuntime | undefined): Promise<unknown> {
  if (context === undefined) return body;
  const path = stripPrefix(url, "");
  if (path.startsWith("/sessions?")) {
    const cwd = new URL(`http://local${path}`).searchParams.get("cwd");
    if (cwd !== null) await assertManagedCwd(managementProjectRoot(managementEmbed), context, cwd, { create: false });
    return body;
  }
  if (path === "/sessions" && isRecord(body) && typeof body["cwd"] === "string") {
    return { ...body, cwd: await assertManagedCwd(managementProjectRoot(managementEmbed), context, body["cwd"]) };
  }
  return body;
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

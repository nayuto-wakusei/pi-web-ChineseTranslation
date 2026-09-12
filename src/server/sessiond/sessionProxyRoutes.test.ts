import Fastify, { type FastifyInstance } from "fastify";
import { dirname } from "node:path";
import fastifyWebsocket from "@fastify/websocket";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSessionProxyRoutes } from "./sessionProxyRoutes";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedRuntime } from "../managementEmbed";

let app: FastifyInstance;
let daemon: FakeSessionDaemon;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  daemon = await FakeSessionDaemon.create();
  registerSessionProxyRoutes(app, daemon, "/api/machines/local", undefined, undefined, () => Promise.resolve([process.cwd()]));
});

afterEach(async () => {
  await app.close();
  await daemon.close();
});

describe("machine-scoped session proxy routes", () => {
  it.each(["/api", "/api/machines/local"])("restricts normal cleanup and archive mutations to registered workspaces through %s", async (prefix) => {
    await app.close();
    app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    const cwd = process.cwd();
    const outside = dirname(cwd);
    registerSessionProxyRoutes(app, daemon, prefix, undefined, undefined, () => Promise.resolve([cwd]));
    const preview = await app.inject({ method: "POST", url: `${prefix}/sessions/cleanup/preview`, payload: { archiveIdleDays: 30 } });
    expect(preview.statusCode).toBe(200);
    expect(daemon.requests[0]?.body).toEqual({ archiveIdleDays: 30, projectCwds: [cwd] });
    for (const suffix of ["archive", "archive-tree", "restore"]) {
      const rejected = await app.inject({ method: "POST", url: `${prefix}/sessions/s1/${suffix}`, payload: { cwd: outside } });
      expect(rejected.statusCode).toBe(403);
    }
    expect((await app.inject({ method: "DELETE", url: `${prefix}/sessions/s1?cwd=${encodeURIComponent(outside)}` })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `${prefix}/sessions/bulk/archive`, payload: { sessions: [{ id: "s1", cwd }, { id: "s2", cwd: outside }] } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `${prefix}/sessions/cleanup`, payload: { projectCwds: [outside] } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `${prefix}/sessions/s1/archive`, payload: { cwd, scopeProjectId: "p1" } })).statusCode).toBe(400);
    expect(daemon.requests).toHaveLength(1);
  });

  it("requires an unambiguous managed project and strips gateway scope metadata", async () => {
    await app.close();
    app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    const cwd = process.cwd();
    const other = dirname(cwd);
    registerSessionProxyRoutes(app, daemon, "/api", {
      enabled: true, projectRoot: cwd,
      authenticate: () => Promise.resolve({ user: { id: "u", rootUserId: "u", roles: [], permissions: [] }, projects: [{ id: "p1", name: "one", root: cwd }, { id: "p2", name: "two", root: other }] }),
    }, (id) => Promise.resolve(id === "p1" ? [cwd] : [other]));
    const url = "/api/sessions/s1/archive?embed=management&token=test";
    expect((await app.inject({ method: "POST", url, payload: { cwd } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, payload: { cwd: other, scopeProjectId: "p1" } })).statusCode).toBe(403);
    expect(daemon.requests).toHaveLength(0);
    expect((await app.inject({ method: "POST", url, payload: { cwd, scopeProjectId: "p1" } })).statusCode).toBe(200);
    expect(daemon.requests[0]?.body).toEqual({ cwd });
  });

  it("strips the machine prefix before forwarding session requests", async () => {
    const response = await app.inject({ method: "GET", url: "/api/machines/local/sessions?cwd=/repo" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(daemon.requests).toEqual([{ method: "GET", path: "/sessions?cwd=/repo", body: undefined }]);
  });

  it("forwards queue-clear mutations and their status through the session daemon", async () => {
    const status = { sessionId: "session-1", pendingMessageCount: 0, queuedMessages: [] };
    daemon.respondWith({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(status) });

    const response = await app.inject({ method: "POST", url: "/api/machines/local/sessions/session-1/queue/clear", payload: { cwd: "/repo" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(status);
    expect(daemon.requests).toEqual([{ method: "POST", path: "/sessions/session-1/queue/clear", body: { cwd: "/repo" } }]);
  });

  it("validates management cwd context for session search and pin routes", async () => {
    const cwd = process.cwd();
    const managementContext = {
      user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: [] },
      projects: [{ id: "p1", name: "Project 1", root: cwd }],
    };
    const managementEmbed: ManagementEmbedRuntime = {
      enabled: true,
      projectRoot: cwd,
      authenticate: () => Promise.resolve(managementContext),
    };
    await app.close();
    await daemon.close();
    app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    daemon = await FakeSessionDaemon.create();
    registerSessionProxyRoutes(app, daemon, "/api/machines/local", managementEmbed, (projectId) => Promise.resolve(projectId === "p1" ? [cwd] : []));

    const queryCwd = encodeURIComponent(cwd);
    const searchResponse = await app.inject({ method: "GET", url: `/api/machines/local/sessions/search?cwd=${queryCwd}&q=needle&embed=management&token=launch-token` });
    const pinsResponse = await app.inject({ method: "GET", url: `/api/machines/local/sessions/pins?cwd=${queryCwd}&embed=management&token=launch-token` });
    const pinResponse = await app.inject({ method: "PUT", url: "/api/machines/local/sessions/session-1/pin?embed=management&token=launch-token", payload: { cwd } });
    const unpinResponse = await app.inject({ method: "DELETE", url: `/api/machines/local/sessions/session-1/pin?cwd=${queryCwd}&embed=management&token=launch-token` });

    expect(searchResponse.statusCode).toBe(200);
    expect(pinsResponse.statusCode).toBe(200);
    expect(pinResponse.statusCode).toBe(200);
    expect(unpinResponse.statusCode).toBe(200);
    expect(daemon.requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "GET", path: `/sessions/search?cwd=${queryCwd}&q=needle&embed=management&token=launch-token`, body: undefined },
      { method: "GET", path: `/sessions/pins?cwd=${queryCwd}&embed=management&token=launch-token`, body: undefined },
      { method: "PUT", path: "/sessions/session-1/pin?embed=management&token=launch-token", body: { cwd } },
      { method: "DELETE", path: `/sessions/session-1/pin?cwd=${queryCwd}&embed=management&token=launch-token`, body: undefined },
    ]);
    expect(decodeManagementContext(daemon.requestHeaders[0]?.[MANAGEMENT_EMBED_CONTEXT_HEADER])).toEqual(managementContext);
  });

  it.each(["/api", "/api/machines/local"])("validates every session cwd before forwarding through %s", async (prefix) => {
    const cwd = process.cwd();
    const outsideCwd = dirname(cwd);
    await app.close();
    app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    registerSessionProxyRoutes(app, daemon, prefix, {
      enabled: true,
      projectRoot: cwd,
      authenticate: () => Promise.resolve({
        user: { id: "limited-user", rootUserId: "root", roles: [], permissions: [] },
        projects: [{ id: "p1", name: "Project", root: cwd }],
      }),
    }, () => Promise.resolve([cwd]));
    const managementQuery = "embed=management&token=launch-token";
    for (const candidateCwd of [outsideCwd, cwd]) {
      const expectedStatus = candidateCwd === cwd ? 200 : 502;
      for (const path of ["/sessions/search-content", "/sessions/s1/messages", "/sessions/s1/status", "/sessions/s1/models", "/sessions/s1/stream-snapshot"]) {
        const response = await app.inject({ method: "GET", url: `${prefix}${path}?cwd=${encodeURIComponent(candidateCwd)}&q=needle&${managementQuery}` });
        expect(response.statusCode, path).toBe(expectedStatus);
      }
      for (const path of ["/sessions", "/sessions/s1/pin", "/sessions/s1/prompt", "/sessions/s1/archive", "/sessions/s1/tree/navigate", "/sessions/s1/attachments"]) {
        const response = await app.inject({ method: "POST", url: `${prefix}${path}?${managementQuery}`, payload: { cwd: candidateCwd } });
        expect(response.statusCode, path).toBe(path.endsWith("/archive") && candidateCwd !== cwd ? 403 : expectedStatus);
      }
      const deleted = await app.inject({ method: "DELETE", url: `${prefix}/sessions/s1?cwd=${encodeURIComponent(candidateCwd)}&${managementQuery}` });
      expect(deleted.statusCode).toBe(candidateCwd === cwd ? 200 : 403);
      for (const path of ["/sessions/bulk/archive", "/sessions/bulk/delete-archived"]) {
        const response = await app.inject({ method: "POST", url: `${prefix}${path}?${managementQuery}`, payload: { sessions: [{ id: "s1", cwd }, { id: "s2", cwd: candidateCwd }] } });
        expect(response.statusCode, path).toBe(candidateCwd === cwd ? 200 : 403);
      }
      if (candidateCwd === outsideCwd) expect(daemon.requests).toEqual([]);
    }
    expect(daemon.requests).toHaveLength(14);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${serverUrl(app)}${prefix}/sessions/s1/events?cwd=${encodeURIComponent(outsideCwd)}&${managementQuery}`);
    const errorMessage = waitForMessage(socket);
    await waitForOpen(socket);
    expect(await errorMessage).toContain("managed project sandbox");
    expect(daemon.websocketPaths).toEqual([]);
    socket.close();
  });

  it.each(["/api", "/api/machines/local"])("forwards management context and notice access denials through %s", async (prefix) => {
    const managementContext = {
      user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: [] },
      projects: [{ id: "p1", name: "Project 1", root: process.cwd() }],
    };
    await app.close();
    app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    registerSessionProxyRoutes(app, daemon, prefix, {
      enabled: true,
      projectRoot: process.cwd(),
      authenticate: () => Promise.resolve(managementContext),
    });
    const error = { error: "Server notices are unavailable in management embed mode" };
    const query = "?embed=management&token=launch-token";
    const dismissal = { daemonInstanceId: "daemon-a", noticeId: "notice-1" };
    for (const method of ["GET", "POST"] as const) {
      daemon.respondWith({ statusCode: 403, headers: { "content-type": "application/json" }, body: JSON.stringify(error) });
      const response = await app.inject({
        method,
        url: `${prefix}/notices${method === "POST" ? "/dismiss" : ""}${query}`,
        ...(method === "POST" ? { payload: dismissal } : {}),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual(error);
    }
    expect(daemon.requests).toEqual([
      { method: "GET", path: `/notices${query}`, body: undefined },
      { method: "POST", path: `/notices/dismiss${query}`, body: dismissal },
    ]);
    expect(daemon.requestHeaders.map((headers) => decodeManagementContext(headers?.[MANAGEMENT_EMBED_CONTEXT_HEADER])))
      .toEqual([managementContext, managementContext]);
  });

  it("limits management cleanup to the selected project's workspace paths", async () => {
    const cwd = process.cwd();
    const outsideCwd = dirname(cwd);
    const managementContext = {
      user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: [] },
      projects: [{ id: "p1", name: "Project 1", root: cwd }, { id: "p2", name: "Project 2", root: outsideCwd }],
    };
    const managementEmbed: ManagementEmbedRuntime = {
      enabled: true,
      projectRoot: cwd,
      authenticate: () => Promise.resolve(managementContext),
    };
    await app.close();
    await daemon.close();
    app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    daemon = await FakeSessionDaemon.create();
    registerSessionProxyRoutes(app, daemon, "/api/machines/local", managementEmbed, (projectId) => Promise.resolve(projectId === "p1" ? [cwd] : [outsideCwd]));

    const previewResponse = await app.inject({
      method: "POST",
      url: "/api/machines/local/sessions/cleanup/preview?embed=management&token=launch-token",
      payload: { projectId: "p1", archiveIdleDays: 30, projectCwds: [cwd] },
    });
    const rejectedResponse = await app.inject({
      method: "POST",
      url: "/api/machines/local/sessions/cleanup?embed=management&token=launch-token",
      payload: { projectId: "p1", archiveIdleDays: 30, projectCwds: [outsideCwd] },
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(rejectedResponse.statusCode).toBe(403);
    expect(daemon.requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "POST", path: "/sessions/cleanup/preview?embed=management&token=launch-token", body: { projectId: "p1", archiveIdleDays: 30, projectCwds: [cwd] } },
    ]);
  });

  it("strips the machine prefix before forwarding auth requests", async () => {
    const response = await app.inject({ method: "POST", url: "/api/machines/local/auth/api-key", payload: { providerId: "p", key: "k" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(daemon.requests).toEqual([{ method: "POST", path: "/auth/api-key", body: { providerId: "p", key: "k" } }]);
  });

  it("forwards sessiond health and runtime aliases to daemon endpoints", async () => {
    const healthResponse = await app.inject({ method: "GET", url: "/api/machines/local/sessiond/health" });
    const runtimeResponse = await app.inject({ method: "GET", url: "/api/machines/local/sessiond/runtime" });

    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toEqual({ ok: true });
    expect(runtimeResponse.statusCode).toBe(200);
    expect(runtimeResponse.json()).toEqual({ ok: true });
    expect(daemon.requests).toEqual([
      { method: "GET", path: "/health", body: undefined },
      { method: "GET", path: "/runtime", body: undefined },
    ]);
  });

  it("forwards empty upstream responses without parsing a body", async () => {
    daemon.respondWith({ statusCode: 204, headers: {}, body: "" });

    const query = `?cwd=${encodeURIComponent(process.cwd())}`;
    const response = await app.inject({ method: "DELETE", url: `/api/machines/local/sessions/session-1${query}` });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(daemon.requests).toEqual([{ method: "DELETE", path: `/sessions/session-1${query}`, body: undefined }]);
  });

  it("returns a 502 response when the daemon request fails", async () => {
    daemon.failWith(new Error("connection refused"));

    const response = await app.inject({ method: "GET", url: "/api/machines/local/sessions" });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "Session daemon unavailable: connection refused" });
    expect(daemon.requests).toEqual([{ method: "GET", path: "/sessions", body: undefined }]);
  });

  it("preserves cwd query context when forwarding session event websockets", async () => {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${serverUrl(app)}/api/machines/local/sessions/session-1/events?cwd=${encodeURIComponent("/repo")}`);

    try {
      await waitForOpen(socket);
      expect(daemon.websocketPaths).toEqual(["/sessions/session-1/events?cwd=%2Frepo"]);
    } finally {
      socket.close();
    }
  });

  it("forwards management context headers to session daemon websockets", async () => {
    const managementContext = {
      user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: [] },
      projects: [{ id: "p1", name: "Project 1" }],
    };
    const managementEmbed: ManagementEmbedRuntime = {
      enabled: true,
      projectRoot: "/managed",
      authenticate: () => Promise.resolve(managementContext),
    };
    await app.close();
    await daemon.close();
    app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    daemon = await FakeSessionDaemon.create();
    registerSessionProxyRoutes(app, daemon, "/api/machines/local", managementEmbed);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${serverUrl(app)}/api/machines/local/sessions/session-1/events?embed=management&token=launch-token`);

    try {
      await waitForOpen(socket);
      expect(daemon.websocketPaths).toEqual(["/sessions/session-1/events?embed=management&token=launch-token"]);
      expect(decodeManagementContext(daemon.websocketHeaders[0]?.[MANAGEMENT_EMBED_CONTEXT_HEADER])).toEqual(managementContext);
    } finally {
      socket.close();
    }
  });

  it("streams daemon events over a cookie-authenticated management websocket", async () => {
    const managementContext = {
      user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: [] },
      projects: [{ id: "p1", name: "Project 1" }],
    };
    const managementEmbed: ManagementEmbedRuntime = {
      enabled: true,
      projectRoot: "/managed",
      authenticate: () => Promise.reject(new Error("entry token should not be required")),
      readSession: (id) => id === "session-1" ? managementContext : undefined,
      sessionCookieName: "pi_web_management_session",
    };
    await app.close();
    await daemon.close();
    app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    daemon = await FakeSessionDaemon.create();
    registerSessionProxyRoutes(app, daemon, "/api/machines/local", managementEmbed);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${serverUrl(app)}/api/machines/local/sessions/session-1/events?embed=management`, {
      headers: { cookie: "pi_web_management_session=session-1" },
    });

    try {
      await waitForOpen(socket);
      await daemon.waitForConnection();
      const message = waitForMessage(socket);
      daemon.broadcast(JSON.stringify({ type: "assistant.delta", text: "streamed" }));

      await expect(message).resolves.toBe(JSON.stringify({ type: "assistant.delta", text: "streamed" }));
      expect(decodeManagementContext(daemon.websocketHeaders[0]?.[MANAGEMENT_EMBED_CONTEXT_HEADER])).toEqual(managementContext);
    } finally {
      socket.close();
    }
  });
});

interface FakeSessionDaemonResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

class FakeSessionDaemon {
  readonly requests: { method: string; path: string; body: unknown }[] = [];
  readonly requestHeaders: (Record<string, string> | undefined)[] = [];
  readonly websocketPaths: string[] = [];
  readonly websocketHeaders: (Record<string, string> | undefined)[] = [];
  private readonly queuedResponses: (FakeSessionDaemonResponse | Error)[] = [];
  private readonly sockets = new Set<WebSocket>();

  private constructor(private readonly upstream: WebSocketServer) {
    this.upstream.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => { this.sockets.delete(socket); });
    });
  }

  static async create(): Promise<FakeSessionDaemon> {
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await waitForListening(upstream);
    return new FakeSessionDaemon(upstream);
  }

  respondWith(response: FakeSessionDaemonResponse): void {
    this.queuedResponses.push(response);
  }

  failWith(error: Error): void {
    this.queuedResponses.push(error);
  }

  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<FakeSessionDaemonResponse> {
    this.requests.push({ method, path, body });
    this.requestHeaders.push(headers);
    const queuedResponse = this.queuedResponses.shift();
    if (queuedResponse instanceof Error) return Promise.reject(queuedResponse);
    return Promise.resolve(queuedResponse ?? { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) });
  }

  connectWebSocket(path: string, headers?: Record<string, string>): WebSocket {
    this.websocketPaths.push(path);
    this.websocketHeaders.push(headers);
    return new WebSocket(`${webSocketServerUrl(this.upstream)}${path}`);
  }

  waitForConnection(): Promise<void> {
    if (this.sockets.size > 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.upstream.once("connection", () => { resolve(); });
    });
  }

  broadcast(payload: string): void {
    for (const socket of this.sockets) socket.send(payload);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    await closeWebSocketServer(this.upstream);
  }
}

function serverUrl(instance: FastifyInstance): string {
  const address = instance.server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP server address");
  return `ws://127.0.0.1:${String(address.port)}`;
}

function webSocketServerUrl(server: WebSocketServer): string {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP server address");
  return `ws://127.0.0.1:${String(address.port)}`;
}

function waitForListening(server: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    server.once("listening", () => { resolve(); });
  });
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once("open", () => { resolve(); });
    socket.once("error", reject);
    socket.once("close", () => { reject(new Error("WebSocket closed before opening")); });
  });
}

function waitForMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => { resolve(rawDataText(data)); });
    socket.once("error", reject);
    socket.once("close", () => { reject(new Error("WebSocket closed before receiving a message")); });
  });
}

function rawDataText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("utf8");
  return data.toString("utf8");
}

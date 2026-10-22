import { dirname } from "node:path";
import { Readable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import { registerSessionProxyRoutes, type SessionProxyDaemon } from "./sessionProxyRoutes.js";

let app: FastifyInstance;
let requestStream: ReturnType<typeof vi.fn<SessionProxyDaemon["requestStream"]>>;

const mediaPath = `/sessions/s1/media/${"a".repeat(64)}`;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  requestStream = vi.fn<SessionProxyDaemon["requestStream"]>();
});

afterEach(async () => {
  app.server.closeAllConnections();
  await app.close();
});

function daemon(): SessionProxyDaemon {
  return {
    request: () => Promise.reject(new Error("JSON requests are not expected")),
    requestStream,
    connectWebSocket: () => { throw new Error("WebSockets are not expected"); },
  };
}

describe("session media binary proxy", () => {
  it.each(["/api", "/api/machines/local"])("preserves binary bytes and cache headers through %s", async (prefix) => {
    registerSessionProxyRoutes(app, daemon(), prefix);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0xc3, 0x28]);
    requestStream.mockResolvedValue({
      statusCode: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(bytes.length),
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "set-cookie": "must-not-cross=1",
      },
      body: Readable.from([bytes]),
    });
    const response = await app.inject({ url: `${prefix}${mediaPath}?cwd=%2Frepo` });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(bytes);
    expect(response.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(requestStream.mock.calls[0]?.[0]).toBe(`${mediaPath}?cwd=%2Frepo`);
    expect(requestStream.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("preserves media error status and JSON bodies", async () => {
    registerSessionProxyRoutes(app, daemon());
    requestStream.mockResolvedValue({ statusCode: 404, headers: { "content-type": "application/json" }, body: Readable.from([JSON.stringify({ error: "Media not found" })]) });
    const response = await app.inject({ url: `/api${mediaPath}?cwd=%2Frepo` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Media not found" });
    expect(response.headers["cache-control"]).toBeUndefined();
  });

  it("reports transport failure instead of returning a successful image", async () => {
    registerSessionProxyRoutes(app, daemon());
    requestStream.mockRejectedValue(new Error("connection refused"));
    const response = await app.inject({ url: `/api${mediaPath}?cwd=%2Frepo` });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "Session daemon unavailable: connection refused" });
    expect(response.headers["cache-control"]).toBeUndefined();
  });

  it("starts streaming before completion and cancels the daemon request when the browser disconnects", async () => {
    registerSessionProxyRoutes(app, daemon());
    const upstream = new Readable({ read() { /* Remain open until browser cancellation. */ } });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    upstream.push(bytes);
    requestStream.mockResolvedValue({ statusCode: 200, headers: { "content-type": "image/png" }, body: upstream });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    const response = await fetch(`${address}/api${mediaPath}?cwd=%2Frepo`, { signal: controller.signal });
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Expected a streaming image body");
    expect(await reader.read()).toEqual({ value: new Uint8Array(bytes), done: false });
    controller.abort();
    await expect(reader.read()).rejects.toThrow();
    await vi.waitFor(() => { expect(upstream.destroyed).toBe(true); });
    expect(requestStream.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("validates all management cwd values before streaming and forwards the trusted context", async () => {
    const cwd = process.cwd();
    const context = {
      user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: [] },
      projects: [{ id: "p1", name: "Project 1", root: cwd }],
    };
    registerSessionProxyRoutes(app, daemon(), "/api", { enabled: true, projectRoot: cwd, authenticate: () => Promise.resolve(context) });
    const query = `cwd=${encodeURIComponent(cwd)}&embed=management&token=entry-token`;
    requestStream.mockResolvedValue({ statusCode: 200, headers: { "content-type": "image/png" }, body: Readable.from([Buffer.from([1, 2, 3])]) });
    const rejected = await app.inject({ url: `/api${mediaPath}?${query}&cwd=${encodeURIComponent(dirname(cwd))}` });
    expect(rejected.statusCode).toBe(502);
    expect(requestStream).not.toHaveBeenCalled();
    const response = await app.inject({ url: `/api${mediaPath}?${query}` });
    expect(response.statusCode).toBe(200);
    expect(decodeManagementContext(requestStream.mock.calls[0]?.[1]?.headers?.[MANAGEMENT_EMBED_CONTEXT_HEADER])).toEqual(context);
  });
});

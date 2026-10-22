import { Readable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import { RemoteMachineRequestError, type MachineClient } from "./machineClient.js";
import type { MachineService } from "./machineService.js";
import { registerMachineProxyRoutes } from "./machineProxyRoutes.js";

const mediaId = "a".repeat(64);
const mediaPath = `/api/machines/remote%20one/sessions/s%201/media/${mediaId}?cwd=%2Frepo`;
const securityPolicy = "sandbox; default-src 'none'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const hostileHeaders = {
  "Content-Security-Policy": ["default-src * 'unsafe-inline' 'unsafe-eval'", "sandbox allow-scripts allow-same-origin"],
  "X-Content-Type-Options": "sniff",
  "Content-Disposition": "attachment; filename=active.html",
  "set-cookie": "must-not-cross=1",
  location: "https://attacker.test/",
};

let app: FastifyInstance;
let request: MockedFunction<MachineClient["request"]>;
let remoteClient: MockedFunction<MachineService["remoteClient"]>;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  request = vi.fn<MachineClient["request"]>();
  const client: MachineClient = {
    request,
    requestJson: () => Promise.reject(new Error("JSON requests are not expected")),
    connectWebSocket: () => { throw new Error("WebSockets are not expected"); },
  };
  remoteClient = vi.fn<MachineService["remoteClient"]>(() => Promise.resolve(client));
  registerMachineProxyRoutes(app, { remoteClient });
});

afterEach(async () => {
  app.server.closeAllConnections();
  await app.close();
});

function expectSafeHeaders(headers: Record<string, unknown>): void {
  expect(headers["content-security-policy"]).toBe(securityPolicy);
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["content-disposition"]).toBe("inline");
  expect(headers["set-cookie"]).toBeUndefined();
  expect(headers["location"]).toBeUndefined();
}

describe("federated session media response safety", () => {
  it.each(["image/png", "image/jpeg", "image/gif", "image/webp"])("streams %s with cache metadata but gateway-controlled security headers", async (mimeType) => {
    const bytes = Buffer.from([0x89, 0x50, 0xff, 0x00, 0xc3, 0x28]);
    request.mockResolvedValue({
      statusCode: 200,
      headers: {
        ...hostileHeaders,
        "content-type": mimeType,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=31536000, immutable",
        "last-modified": "Wed, 05 Aug 2026 10:00:00 GMT",
        etag: '"media-etag"',
      },
      body: Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]),
    });

    const response = await app.inject({ url: mediaPath });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(bytes);
    expect(response.headers["content-type"]).toBe(mimeType);
    expect(response.headers["content-length"]).toBe(String(bytes.byteLength));
    expect(response.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(response.headers["last-modified"]).toBe("Wed, 05 Aug 2026 10:00:00 GMT");
    expect(response.headers.etag).toBe('"media-etag"');
    expectSafeHeaders(response.headers);
    expect(remoteClient).toHaveBeenCalledWith("remote one");
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.slice(0, 3)).toEqual(["GET", `/api/sessions/s%201/media/${mediaId}?cwd=%2Frepo`, undefined]);
    expect(request.mock.calls[0]?.[3]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("canonicalizes a supported HTTP MIME and supplies security headers absent upstream", async () => {
    request.mockResolvedValue({ statusCode: 200, headers: { "content-type": "IMAGE/PNG; charset=binary" }, body: Readable.from([Buffer.from([1, 2, 3])]) });

    const response = await app.inject({ url: mediaPath });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.rawPayload).toEqual(Buffer.from([1, 2, 3]));
    expectSafeHeaders(response.headers);
  });

  it.each(["text/html", "application/xhtml+xml", "image/svg+xml", "application/json", "application/octet-stream", undefined])("rejects successful unsafe or missing MIME %s and disposes the unread stream", async (contentType) => {
    const read = vi.fn(function (this: Readable) {
      this.push(Buffer.from("<script>alert(document.domain)</script>"));
      this.push(null);
    });
    const upstream = new Readable({ read });
    request.mockResolvedValue({
      statusCode: 200,
      headers: { ...hostileHeaders, "content-type": contentType, "content-length": "99999", "cache-control": "public, max-age=31536000, immutable" },
      body: upstream,
    });

    const response = await app.inject({ url: mediaPath });

    expect(response.statusCode).toBe(502);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({ error: "Remote machine unavailable", statusCode: 502, detail: "Remote machine returned an unsupported session image MIME type" });
    expect(response.body).not.toContain("<script>");
    expect(response.headers["cache-control"]).toBeUndefined();
    expect(response.headers["content-length"]).toBe(String(response.rawPayload.byteLength));
    expectSafeHeaders(response.headers);
    expect(upstream.destroyed).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([302, 401, 404, 503])("replaces an unsafe upstream page with a safe error while preserving status %i", async (statusCode) => {
    const read = vi.fn(function (this: Readable) {
      this.push(Buffer.from("<script>location='https://attacker.test/'</script>"));
      this.push(null);
    });
    const upstream = new Readable({ read });
    request.mockResolvedValue({ statusCode, headers: { ...hostileHeaders, "content-type": "text/html", "content-length": "99999" }, body: upstream });

    const response = await app.inject({ url: mediaPath });

    expect(response.statusCode).toBe(statusCode);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({ error: "Remote session media request failed", statusCode });
    expect(response.headers["content-length"]).toBe(String(response.rawPayload.byteLength));
    expectSafeHeaders(response.headers);
    expect(upstream.destroyed).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves useful JSON error details without allowing hostile headers to activate them", async () => {
    const error = { error: "Session media not found", code: "media-not-found", detail: "Missing <script>alert(1)</script>" };
    const bytes = Buffer.from(JSON.stringify(error));
    request.mockResolvedValue({
      statusCode: 404,
      headers: { ...hostileHeaders, "content-type": "application/json; charset=utf-8", "content-length": String(bytes.byteLength) },
      body: Readable.from([bytes.subarray(0, 8), bytes.subarray(8)]),
    });

    const response = await app.inject({ url: mediaPath });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(response.json()).toEqual(error);
    expectSafeHeaders(response.headers);
  });

  it("keeps an HTML error mislabeled as JSON inert instead of trusting upstream security headers", async () => {
    const page = "<script>alert(document.domain)</script>";
    request.mockResolvedValue({ statusCode: 500, headers: { ...hostileHeaders, "content-type": "application/json" }, body: Readable.from([page]) });

    const response = await app.inject({ url: mediaPath });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(response.body).toBe(page);
    expectSafeHeaders(response.headers);
  });

  it.each([
    { error: new RemoteMachineRequestError("timed out", 504), statusCode: 504, label: "Remote machine timeout" },
    { error: new Error("connection refused"), statusCode: 502, label: "Remote machine unavailable" },
  ])("hardens transport failures with status $statusCode", async ({ error, statusCode, label }) => {
    request.mockRejectedValue(error);

    const response = await app.inject({ url: mediaPath });

    expect(response.statusCode).toBe(statusCode);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({ error: label, statusCode, detail: error.message });
    expectSafeHeaders(response.headers);
  });

  it("hardens a missing-machine error before contacting upstream", async () => {
    remoteClient.mockResolvedValue(undefined);

    const response = await app.inject({ url: mediaPath });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Machine not found" });
    expectSafeHeaders(response.headers);
    expect(request).not.toHaveBeenCalled();
  });

  it("streams a valid image before upstream completes and releases it when the browser disconnects", async () => {
    const upstream = new Readable({ read() { /* stays open until the browser disconnects */ } });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    upstream.push(bytes);
    request.mockResolvedValue({ statusCode: 200, headers: { "content-type": "image/png" }, body: upstream });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();

    const response = await fetch(`${address}${mediaPath}`, { signal: controller.signal });
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Expected a streaming image body");
    expect(response.status).toBe(200);
    expect(await reader.read()).toEqual({ value: new Uint8Array(bytes), done: false });
    controller.abort();

    await expect(reader.read()).rejects.toThrow();
    await vi.waitFor(() => { expect(upstream.destroyed).toBe(true); });
    expect(request.mock.calls[0]?.[3]?.signal?.aborted).toBe(true);
  });
});

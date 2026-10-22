import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDaemonClient } from "./sessionDaemonClient.js";

const servers: http.Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); });
  }
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("session daemon binary transport", () => {
  it.each(["tcp", "socket"])("preserves image bytes over %s", async (transport) => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0xc3, 0x28]);
    let requestedPath: string | undefined;
    let requestedHeaders: http.IncomingHttpHeaders | undefined;
    const server = http.createServer((request, response) => {
      requestedPath = request.url;
      requestedHeaders = request.headers;
      response.writeHead(200, {
        "content-type": "image/png",
        "content-length": bytes.length,
        "cache-control": "private, max-age=31536000, immutable",
      });
      response.write(bytes.subarray(0, 4));
      response.end(bytes.subarray(4));
    });
    servers.push(server);
    if (transport === "socket") {
      const directory = await mkdtemp(join(tmpdir(), "pi-web-media-"));
      directories.push(directory);
      const socketPath = process.platform === "win32" ? `\\\\.\\pipe\\pi-web-media-${randomUUID()}` : join(directory, "daemon.sock");
      vi.stubEnv("PI_WEB_SESSIOND_URL", "");
      vi.stubEnv("PI_WEB_SESSIOND_SOCKET", socketPath);
      await new Promise<void>((resolve) => { server.listen(socketPath, resolve); });
    } else {
      await listenTcp(server);
    }
    const path = `/sessions/session-1/media/${"a".repeat(64)}?cwd=%2Frepo`;
    const result = await new SessionDaemonClient().requestStream(path, { headers: { "x-test-management-context": "trusted-context", "accept-encoding": "gzip" } });
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) {
      if (!Buffer.isBuffer(chunk)) throw new Error("Expected binary daemon chunks");
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(requestedPath).toBe(path);
    expect(requestedHeaders?.["x-test-management-context"]).toBe("trusted-context");
    expect(requestedHeaders?.["accept-encoding"]).toBe("identity");
  });

  it("propagates cancellation after headers to a streaming response", async () => {
    let closeResponse: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => { closeResponse = resolve; });
    const server = http.createServer((_request, response) => {
      response.on("close", () => { closeResponse?.(); });
      response.writeHead(200, { "content-type": "image/png" });
      response.write(Buffer.from([0x89, 0x50]));
      // Deliberately leave the body open until the client cancels.
    });
    servers.push(server);
    await listenTcp(server);
    const controller = new AbortController();
    const result = await new SessionDaemonClient().requestStream("/sessions/s1/media/image", { signal: controller.signal });
    result.body.on("error", () => { /* Expected abort of the unfinished image body. */ });
    controller.abort();
    await closed;
    expect(controller.signal.aborted).toBe(true);
  });
});

async function listenTcp(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
  vi.stubEnv("PI_WEB_SESSIOND_URL", `http://127.0.0.1:${String(address.port)}`);
}

import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import type { MachineClient } from "./machineClient.js";
import { registerMachineProxyRoutes } from "./machineProxyRoutes.js";

describe("MCP authentication federation", () => {
  it.each([200, 404].flatMap((statusCode) => [undefined, "public, max-age=3600", "no-store"].map((cacheControl) => ({ statusCode, cacheControl }))))("enforces no-store for MCP status $statusCode with upstream $cacheControl", async ({ statusCode, cacheControl }) => {
    const app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    const body = statusCode === 200 ? { flowId: "flow-1", target: "mcp", status: "running", auth: { url: "https://issuer.test/authorize" } } : { error: "MCP authentication flow not found" };
    const request = vi.fn<MachineClient["request"]>().mockResolvedValue({
      statusCode, body: Readable.from([JSON.stringify(body)]),
      headers: { "content-type": "application/json", ...(cacheControl === undefined ? {} : { "cache-control": cacheControl }), "set-cookie": "private=must-not-cross" },
    });
    const client: MachineClient = { request, requestJson: () => Promise.reject(new Error("Unexpected JSON request")), connectWebSocket: () => { throw new Error("Unexpected socket"); } };
    registerMachineProxyRoutes(app, { remoteClient: () => Promise.resolve(client) });
    try {
      const response = await app.inject({ url: "/api/machines/remote%20one/auth/mcp/flow-1" });
      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toEqual(body);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(request.mock.calls[0]?.slice(0, 3)).toEqual(["GET", "/api/auth/mcp/flow-1", undefined]);
    } finally {
      await app.close();
    }
  });
});

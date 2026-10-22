import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { describe, expect, it, vi } from "vitest";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import { testManagementContext } from "../sessions/piSessionService.testSupport.js";
import { registerSessionProxyRoutes, type SessionProxyDaemon } from "./sessionProxyRoutes.js";

describe("naming model proxy scope", () => {
  it.each(["/api", "/api/machines/local"].flatMap((prefix) => [false, true].map((management) => ({ prefix, management }))))("forwards the original auth target through $prefix with management=$management", async ({ prefix, management }) => {
    const app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    const context = testManagementContext();
    const request = vi.fn<SessionProxyDaemon["request"]>().mockResolvedValue({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ models: [{ provider: "test", id: "naming", name: "Naming model" }] }) });
    const daemon: SessionProxyDaemon = { request, requestStream: () => Promise.reject(new Error("Unexpected stream")), connectWebSocket: () => { throw new Error("Unexpected session socket"); } };
    registerSessionProxyRoutes(app, daemon, prefix, management ? { enabled: true, projectRoot: process.cwd(), authenticate: () => Promise.resolve(context) } : undefined);
    try {
      const query = management ? "?embed=management&token=test-entry" : "?projectId=project%20a";
      const response = await app.inject({ url: `${prefix}/models${query}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ models: [{ provider: "test", id: "naming", name: "Naming model" }] });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0]?.slice(0, 3)).toEqual(["GET", `/models${query}`, undefined]);
      expect(decodeManagementContext(request.mock.calls[0]?.[3]?.[MANAGEMENT_EMBED_CONTEXT_HEADER])).toEqual(management ? context : undefined);
    } finally { await app.close(); }
  });
});

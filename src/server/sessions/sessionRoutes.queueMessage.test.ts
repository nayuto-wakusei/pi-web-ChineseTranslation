import Fastify from "fastify";
import { resolve } from "node:path";
import fastifyWebsocket from "@fastify/websocket";
import { afterEach, expect, it, vi } from "vitest";
import { createTranslator } from "../../shared/i18n.js";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { PiSessionService } from "./piSessionService.js";
import { emptyArchiveStore, sessionGateway, testManagementContext, testModelRuntime } from "./piSessionService.testSupport.js";
import { registerSessionRoutes } from "./sessionRoutes.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

async function fixture(prefix = "") {
  const app = Fastify();
  await app.register(fastifyWebsocket);
  const hub = new SessionEventHub();
  const service = new PiSessionService(hub, {
    agentDir: "/tmp/pi-web-queue-routes", modelRuntime: testModelRuntime, translator: createTranslator("en", {}),
    sessionManager: sessionGateway([]), archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60_000,
  });
  const status = { sessionId: "session-1", isStreaming: true, isCompacting: false, isBashRunning: false,
    pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
  const mutate = vi.spyOn(service, "mutateQueueMessage").mockResolvedValue(status);
  registerSessionRoutes(app, service, hub, prefix, createTranslator("en", {}));
  cleanups.push(async () => { await app.close(); await service.dispose(); });
  return { app, mutate, status };
}

it.each(["", "/api"])("validates queue mutations and forwards the full session reference and trusted management identity (%s)", async (prefix) => {
  const { app, mutate, status } = await fixture(prefix);
  const context = testManagementContext();
  const mutation = { action: "toggle", index: 0, expectedQueue: [{ kind: "steer", text: "queued", hasAttachments: true, attachmentCount: 2 }] };
  const response = await app.inject({ method: "POST", url: `${prefix}/sessions/Case-Sensitive/queue/message?embed=management&token=entry`,
    headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) }, payload: { cwd: "/repo/./nested/..", ...mutation } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual(status);
  expect(mutate).toHaveBeenCalledExactlyOnceWith({ id: "Case-Sensitive", cwd: resolve("/repo") }, mutation, context);
  mutate.mockClear();
  const invalid = await app.inject({ method: "POST", url: `${prefix}/sessions/Case-Sensitive/queue/message`, payload: { cwd: "/repo", ...mutation, index: 0.5 } });
  expect(invalid.statusCode).toBe(400);
  expect(mutate).not.toHaveBeenCalled();
  mutate.mockRejectedValueOnce(new Error("Queued messages changed; refresh the queue and try again"));
  const stale = await app.inject({ method: "POST", url: `${prefix}/sessions/Case-Sensitive/queue/message`, payload: { cwd: "/repo", ...mutation } });
  expect(stale.statusCode).toBe(400);
  expect(stale.json()).toEqual({ error: "Queued messages changed; refresh the queue and try again" });
});

it("requires cwd and does not treat embed or body context as a management credential", async () => {
  const { app, mutate } = await fixture();
  const mutation = { action: "remove", index: 0, expectedQueue: [{ kind: "steer", text: "queued" }] };
  const missing = await app.inject({ method: "POST", url: "/sessions/id/queue/message", payload: mutation });
  expect(missing.statusCode).toBe(400);
  expect(mutate).not.toHaveBeenCalled();
  const spoof = await app.inject({ method: "POST", url: "/sessions/id/queue/message?embed=management", payload: { cwd: "/repo", ...mutation, managementContext: testManagementContext() } });
  expect(spoof.statusCode).toBe(200);
  expect(mutate).toHaveBeenCalledExactlyOnceWith({ id: "id", cwd: resolve("/repo") }, mutation, undefined);
});

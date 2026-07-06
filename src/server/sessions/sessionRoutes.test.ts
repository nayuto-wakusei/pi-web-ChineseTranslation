import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionBulkArchiveResponse, SessionBulkDeleteArchivedResponse, SessionBulkMutationRef, SessionCleanupExecuteResponse, SessionCleanupPreviewResponse } from "../../shared/apiTypes.js";
import { SessionEventHub, type RealtimeSocket } from "../realtime/sessionEventHub.js";
import { PiSessionService, type PiSessionManagerGateway, type PiSessionRef } from "./piSessionService.js";
import { registerSessionRoutes } from "./sessionRoutes.js";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";
import type { ThinkingLevel } from "../../shared/thinkingLevels.js";
import type { NormalizedSessionCleanupRequest } from "./sessionCleanup.js";
import type { ClientArchiveSessionsResponse } from "../types.js";

let app: FastifyInstance;
let service: PiSessionService;
let sessionManager: RejectingSessionManager;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  sessionManager = new RejectingSessionManager();
  const eventHub = new SessionEventHub();
  service = new PiSessionService(eventHub, { sessionManager, heartbeatIntervalMs: 60_000 });
  registerSessionRoutes(app, service, eventHub);
});

afterEach(async () => {
  await service.dispose();
  await app.close();
});

describe("session routes", () => {
  it("rejects prompt payloads that omit text without opening a session", async () => {
    const response = await app.inject({ method: "POST", url: "/sessions/session-1/prompt", payload: { body: "Build the thing" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "提示文本为必填项" });
    expect(sessionManager.calls).toEqual({ create: 0, list: 0, listAll: 0, open: 0 });
  });

  it("keeps legacy per-session routes usable without cwd", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const statusResponse = await routeApp.inject({ method: "GET", url: "/sessions/session-1/status" });
      const promptResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/prompt", payload: { text: "hello" } });

      expect(statusResponse.statusCode).toBe(200);
      expect(promptResponse.statusCode).toBe(200);
      expect(routeService.calls).toEqual(["session-1", { route: "prompt", lookup: "session-1", text: "hello", managementContext: undefined }]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("forwards prompt attachments and supports the save-attachments route", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    const attachments = [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }];
    try {
      const promptResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/prompt", payload: { text: "look", attachments } });
      expect(promptResponse.statusCode).toBe(200);
      expect(routeService.calls.at(-1)).toEqual({ route: "prompt", lookup: "session-1", text: "look", attachments, managementContext: undefined });

      const saveResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/attachments", payload: { attachments, folder: "uploads" } });
      expect(saveResponse.statusCode).toBe(200);
      expect(saveResponse.json()).toEqual({ attachments: [{ path: "uploads/shot.png", mimeType: "image/png", size: 3 }] });
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("passes cwd when per-session routes include workspace context", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      // The route normalizes the request cwd, so the service sees the resolved
      // absolute path (drive-qualified on Windows).
      const requestCwd = resolve("/repo");
      const statusResponse = await routeApp.inject({ method: "GET", url: `/sessions/session-1/status?cwd=${encodeURIComponent(requestCwd)}` });
      const promptResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/prompt", payload: { cwd: requestCwd, text: "hello" } });

      expect(statusResponse.statusCode).toBe(200);
      expect(promptResponse.statusCode).toBe(200);
      expect(routeService.calls).toEqual([{ id: "session-1", cwd: requestCwd }, { route: "prompt", lookup: { id: "session-1", cwd: requestCwd }, text: "hello", managementContext: undefined }]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("forwards management context to session control routes", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const requestCwd = resolve("/repo");
      const managementContext = testManagementContext();
      const headers = { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(managementContext) };

      const setModelResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/model", headers, payload: { cwd: requestCwd, provider: "openai", modelId: "gpt-test" } });
      const cycleModelResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/model/cycle", headers, payload: { cwd: requestCwd, direction: "backward" } });
      const thinkingLevelsResponse = await routeApp.inject({ method: "GET", url: `/sessions/session-1/thinking-levels?cwd=${encodeURIComponent(requestCwd)}`, headers });
      const setThinkingResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/thinking-level", headers, payload: { cwd: requestCwd, level: "medium" } });
      const cycleThinkingResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/thinking-level/cycle", headers, payload: { cwd: requestCwd } });
      const promptResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/prompt", headers, payload: { cwd: requestCwd, text: "hello" } });
      const attachmentResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/attachments", headers, payload: { cwd: requestCwd, attachments: [{ mimeType: "text/plain", data: Buffer.from("hi").toString("base64"), name: "note.txt" }] } });
      const shellResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/shell", headers, payload: { cwd: requestCwd, text: "!pwd" } });
      const runCommandResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/commands/run", headers, payload: { cwd: requestCwd, text: "/help" } });
      const respondCommandResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/commands/respond", headers, payload: { cwd: requestCwd, requestId: "req-1", value: "yes" } });
      const abortResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/abort", headers, payload: { cwd: requestCwd } });
      const stopResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/stop", headers, payload: { cwd: requestCwd } });
      const archiveResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/archive", headers, payload: { cwd: requestCwd } });
      const archiveTreeResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/archive-tree", headers, payload: { cwd: requestCwd } });
      const restoreResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/restore", headers, payload: { cwd: requestCwd } });
      const deleteResponse = await routeApp.inject({ method: "DELETE", url: `/sessions/session-1?cwd=${encodeURIComponent(requestCwd)}`, headers });
      const reloadResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/reload", headers, payload: { cwd: requestCwd } });
      const detachResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/detach-parent", headers, payload: { cwd: requestCwd } });

      expect(setModelResponse.statusCode).toBe(200);
      expect(cycleModelResponse.statusCode).toBe(200);
      expect(thinkingLevelsResponse.statusCode).toBe(200);
      expect(setThinkingResponse.statusCode).toBe(200);
      expect(cycleThinkingResponse.statusCode).toBe(200);
      expect(promptResponse.statusCode).toBe(200);
      expect(attachmentResponse.statusCode).toBe(200);
      expect(shellResponse.statusCode).toBe(200);
      expect(runCommandResponse.statusCode).toBe(200);
      expect(respondCommandResponse.statusCode).toBe(200);
      expect(abortResponse.statusCode).toBe(200);
      expect(stopResponse.statusCode).toBe(200);
      expect(archiveResponse.statusCode).toBe(200);
      expect(archiveTreeResponse.statusCode).toBe(200);
      expect(restoreResponse.statusCode).toBe(200);
      expect(deleteResponse.statusCode).toBe(200);
      expect(reloadResponse.statusCode).toBe(200);
      expect(detachResponse.statusCode).toBe(200);
      expect(routeService.calls).toEqual([
        { route: "setModel", lookup: { id: "session-1", cwd: requestCwd }, provider: "openai", modelId: "gpt-test", managementContext },
        { route: "cycleModel", lookup: { id: "session-1", cwd: requestCwd }, direction: "backward", managementContext },
        { route: "availableThinkingLevels", lookup: { id: "session-1", cwd: requestCwd }, managementContext },
        { route: "setThinkingLevel", lookup: { id: "session-1", cwd: requestCwd }, level: "medium", managementContext },
        { route: "cycleThinkingLevel", lookup: { id: "session-1", cwd: requestCwd }, managementContext },
        { route: "prompt", lookup: { id: "session-1", cwd: requestCwd }, text: "hello", managementContext },
        { route: "saveAttachments", lookup: { id: "session-1", cwd: requestCwd }, managementContext },
        { route: "shell", lookup: { id: "session-1", cwd: requestCwd }, text: "!pwd", managementContext },
        { route: "runCommand", lookup: { id: "session-1", cwd: requestCwd }, text: "/help", managementContext },
        { route: "respondToCommand", lookup: { id: "session-1", cwd: requestCwd }, requestId: "req-1", value: "yes", managementContext },
        { route: "abort", lookup: { id: "session-1", cwd: requestCwd }, managementContext },
        { route: "stop", lookup: { id: "session-1", cwd: requestCwd }, managementContext },
        { route: "archive", lookup: { id: "session-1", cwd: requestCwd }, managementContext },
        { route: "archiveTree", lookup: { id: "session-1", cwd: requestCwd }, managementContext },
        { route: "restore", lookup: { id: "session-1", cwd: requestCwd }, managementContext },
        { route: "deleteArchived", lookup: { id: "session-1", cwd: requestCwd }, managementContext },
        { route: "reload", lookup: { id: "session-1", cwd: requestCwd }, managementContext },
        { route: "detachParent", lookup: { id: "session-1", cwd: requestCwd }, managementContext },
      ]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("reloads a session through the reload route, forwarding workspace context", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const requestCwd = resolve("/repo");
      const reloadResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/reload", payload: { cwd: requestCwd } });

      expect(reloadResponse.statusCode).toBe(200);
      expect(reloadResponse.json()).toEqual({ reloaded: true });
      expect(routeService.reloadCalls).toEqual([{ id: "session-1", cwd: requestCwd }]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("maps reload failures to a mutation error status", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    routeService.reloadError = new Error("Stop current session activity before reloading");
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const reloadResponse = await routeApp.inject({ method: "POST", url: "/sessions/session-1/reload", payload: {} });

      expect(reloadResponse.statusCode).toBe(400);
      expect(reloadResponse.json()).toEqual({ error: "Stop current session activity before reloading" });
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("normalizes cleanup requests for preview and execute routes", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const previewResponse = await routeApp.inject({ method: "POST", url: "/sessions/cleanup/preview", payload: { archiveIdleDays: 30, deleteArchivedDays: null, projectCwds: ["/repo-a", "/repo-a"] } });
      const executeResponse = await routeApp.inject({ method: "POST", url: "/sessions/cleanup", payload: { archiveIdleDays: null, deleteArchivedDays: 7, projectCwds: ["/repo-b"] } });

      expect(previewResponse.statusCode).toBe(200);
      expect(executeResponse.statusCode).toBe(200);
      expect(routeService.cleanupPreviewCalls).toEqual([{ thresholds: { archiveIdleDays: 30 }, projectCwds: ["/repo-a"] }]);
      expect(routeService.cleanupCalls).toEqual([{ thresholds: { deleteArchivedDays: 7 }, projectCwds: ["/repo-b"] }]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("rejects invalid cleanup thresholds before calling the service", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const response = await routeApp.inject({ method: "POST", url: "/sessions/cleanup", payload: { archiveIdleDays: -1 } });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "archiveIdleDays field must be a non-negative integer" });
      expect(routeService.cleanupCalls).toEqual([]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("routes bulk archive and delete requests with normalized session refs", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const requestCwd = resolve("/repo");
      const archiveResponse = await routeApp.inject({ method: "POST", url: "/sessions/bulk/archive", payload: { sessions: [{ id: "s1", cwd: requestCwd }, { id: "s2" }] } });
      const deleteResponse = await routeApp.inject({ method: "POST", url: "/sessions/bulk/delete-archived", payload: { sessions: [{ id: "s1", cwd: requestCwd }] } });

      expect(archiveResponse.statusCode).toBe(200);
      expect(archiveResponse.json()).toMatchObject({ archived: true, archivedSessionIds: ["s1", "s2"], failures: [] });
      expect(deleteResponse.statusCode).toBe(200);
      expect(deleteResponse.json()).toMatchObject({ deleted: true, deletedSessionIds: ["s1"], failures: [] });
      expect(routeService.bulkArchiveCalls).toEqual([[{ id: "s1", cwd: requestCwd }, { id: "s2" }]]);
      expect(routeService.bulkDeleteCalls).toEqual([[{ id: "s1", cwd: requestCwd }]]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("rejects malformed bulk mutation bodies before calling the service", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new SessionEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);

    try {
      const response = await routeApp.inject({ method: "POST", url: "/sessions/bulk/archive", payload: { sessions: [{ cwd: "/repo" }] } });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "id field must be a string" });
      expect(routeService.bulkArchiveCalls).toEqual([]);
    } finally {
      await routeService.dispose();
      await routeApp.close();
    }
  });

  it("subscribes websocket clients with the decoded management context scope", async () => {
    const routeApp = Fastify({ logger: false });
    await routeApp.register(fastifyWebsocket);
    const eventHub = new CapturingRouteEventHub();
    const routeService = new CapturingRouteSessionService(eventHub);
    registerSessionRoutes(routeApp, routeService, eventHub);
    await routeApp.listen({ host: "127.0.0.1", port: 0 });

    const managementContext = testManagementContext();
    const normalSocket = new WebSocket(`${serverUrl(routeApp)}/sessions/session-1/events`);
    const managedSocket = new WebSocket(`${serverUrl(routeApp)}/sessions/session-1/events`, {
      headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(managementContext) },
    });

    try {
      await Promise.all([waitForOpen(normalSocket), waitForOpen(managedSocket)]);

      expect(eventHub.sessionSubscriptions[0]).toEqual({ sessionId: "session-1", scope: "normal" });
      expect(eventHub.sessionSubscriptions[1]?.sessionId).toBe("session-1");
      expect(eventHub.sessionSubscriptions[1]?.scope).toContain("account-1");
    } finally {
      normalSocket.close();
      managedSocket.close();
      await routeService.dispose();
      await routeApp.close();
    }
  });
});

class CapturingRouteEventHub extends SessionEventHub {
  readonly sessionSubscriptions: { sessionId: string; scope: string }[] = [];

  override add(sessionId: string, socket: RealtimeSocket, scope = "normal"): void {
    this.sessionSubscriptions.push({ sessionId, scope });
    super.add(sessionId, socket, scope);
  }
}

class CapturingRouteSessionService extends PiSessionService {
  readonly calls: unknown[] = [];
  readonly reloadCalls: (string | PiSessionRef)[] = [];
  readonly cleanupPreviewCalls: NormalizedSessionCleanupRequest[] = [];
  readonly cleanupCalls: NormalizedSessionCleanupRequest[] = [];
  readonly bulkArchiveCalls: SessionBulkMutationRef[][] = [];
  readonly bulkDeleteCalls: SessionBulkMutationRef[][] = [];
  reloadError: Error | undefined;

  constructor(eventHub: SessionEventHub) {
    super(eventHub, { sessionManager: new RejectingSessionManager(), heartbeatIntervalMs: 60_000 });
  }

  override cleanupPreview(request: NormalizedSessionCleanupRequest): Promise<SessionCleanupPreviewResponse> {
    this.cleanupPreviewCalls.push(request);
    return Promise.resolve({ generatedAt: "2026-06-25T00:00:00.000Z", thresholds: request.thresholds, projects: [], totals: { archiveCount: 0, deleteCount: 0 } });
  }

  override cleanup(request: NormalizedSessionCleanupRequest): Promise<SessionCleanupExecuteResponse> {
    this.cleanupCalls.push(request);
    return Promise.resolve({ generatedAt: "2026-06-25T00:00:00.000Z", thresholds: request.thresholds, projects: [], totals: { archiveCount: 0, deleteCount: 0 }, archivedSessionIds: [], deletedSessionIds: [] });
  }

  override archiveMany(refs: readonly SessionBulkMutationRef[]): Promise<SessionBulkArchiveResponse> {
    this.bulkArchiveCalls.push([...refs]);
    return Promise.resolve({ archived: true, archivedSessionIds: refs.map((ref) => ref.id), failures: [], generatedAt: "2026-06-25T00:00:00.000Z" });
  }

  override deleteArchivedMany(refs: readonly SessionBulkMutationRef[]): Promise<SessionBulkDeleteArchivedResponse> {
    this.bulkDeleteCalls.push([...refs]);
    return Promise.resolve({ deleted: true, deletedSessionIds: refs.map((ref) => ref.id), failures: [], generatedAt: "2026-06-25T00:00:00.000Z" });
  }

  override reload(lookup: string | PiSessionRef, managementContext?: ManagementEmbedContext): Promise<void> {
    this.reloadCalls.push(lookup);
    this.calls.push({ route: "reload", lookup, managementContext });
    if (this.reloadError !== undefined) return Promise.reject(this.reloadError);
    return Promise.resolve();
  }

  override archive(lookup: string | PiSessionRef, managementContext?: ManagementEmbedContext): Promise<void> {
    this.calls.push({ route: "archive", lookup, managementContext });
    return Promise.resolve();
  }

  override archiveTree(lookup: string | PiSessionRef, managementContext?: ManagementEmbedContext): Promise<ClientArchiveSessionsResponse> {
    this.calls.push({ route: "archiveTree", lookup, managementContext });
    return Promise.resolve({ archived: true, sessionIds: [typeof lookup === "string" ? lookup : lookup.id], archivedCount: 1, skippedAlreadyArchivedCount: 0 });
  }

  override restore(lookup: string | PiSessionRef, managementContext?: ManagementEmbedContext): Promise<void> {
    this.calls.push({ route: "restore", lookup, managementContext });
    return Promise.resolve();
  }

  override deleteArchived(lookup: string | PiSessionRef, managementContext?: ManagementEmbedContext): Promise<void> {
    this.calls.push({ route: "deleteArchived", lookup, managementContext });
    return Promise.resolve();
  }

  override detachParent(lookup: string | PiSessionRef, managementContext?: ManagementEmbedContext): Promise<void> {
    this.calls.push({ route: "detachParent", lookup, managementContext });
    return Promise.resolve();
  }

  override status(lookup: string | PiSessionRef) {
    this.calls.push(lookup);
    return Promise.resolve(statusForLookup(lookup));
  }

  override prompt(lookup: string | PiSessionRef, text: unknown, _streamingBehavior?: unknown, attachments?: unknown, options?: { managementContext?: ManagementEmbedContext }): Promise<void> {
    const managementContext = options?.managementContext;
    this.calls.push(attachments === undefined ? { route: "prompt", lookup, text, managementContext } : { route: "prompt", lookup, text, attachments, managementContext });
    return Promise.resolve();
  }

  override shell(lookup: string | PiSessionRef, text: string, managementContext?: ManagementEmbedContext): Promise<void> {
    this.calls.push({ route: "shell", lookup, text, managementContext });
    return Promise.resolve();
  }

  override runCommand(lookup: string | PiSessionRef, text: string, managementContext?: ManagementEmbedContext) {
    this.calls.push({ route: "runCommand", lookup, text, managementContext });
    return Promise.resolve({ type: "done" as const, message: "done" });
  }

  override respondToCommand(lookup: string | PiSessionRef, requestId: string, value: string, managementContext?: ManagementEmbedContext) {
    this.calls.push({ route: "respondToCommand", lookup, requestId, value, managementContext });
    return Promise.resolve({ type: "done" as const, message: "done" });
  }

  override setModel(lookup: string | PiSessionRef, provider: string, modelId: string, managementContext?: ManagementEmbedContext) {
    this.calls.push({ route: "setModel", lookup, provider, modelId, managementContext });
    return Promise.resolve(statusForLookup(lookup));
  }

  override cycleModel(lookup: string | PiSessionRef, direction: "forward" | "backward", managementContext?: ManagementEmbedContext) {
    this.calls.push({ route: "cycleModel", lookup, direction, managementContext });
    return Promise.resolve(statusForLookup(lookup));
  }

  override availableThinkingLevels(lookup: string | PiSessionRef, managementContext?: ManagementEmbedContext): Promise<ThinkingLevel[]> {
    this.calls.push({ route: "availableThinkingLevels", lookup, managementContext });
    return Promise.resolve(["off", "medium"]);
  }

  override setThinkingLevel(lookup: string | PiSessionRef, level: string, managementContext?: ManagementEmbedContext) {
    this.calls.push({ route: "setThinkingLevel", lookup, level, managementContext });
    return Promise.resolve(statusForLookup(lookup));
  }

  override cycleThinkingLevel(lookup: string | PiSessionRef, managementContext?: ManagementEmbedContext) {
    this.calls.push({ route: "cycleThinkingLevel", lookup, managementContext });
    return Promise.resolve(statusForLookup(lookup));
  }

  override abort(lookup: string | PiSessionRef, managementContext?: ManagementEmbedContext): Promise<void> {
    this.calls.push({ route: "abort", lookup, managementContext });
    return Promise.resolve();
  }

  override stop(lookup: string | PiSessionRef, managementContext?: ManagementEmbedContext): void {
    this.calls.push({ route: "stop", lookup, managementContext });
  }

  override saveAttachments(lookup: string | PiSessionRef, attachments: unknown, folder?: string, managementContext?: ManagementEmbedContext) {
    this.calls.push({ route: "saveAttachments", lookup, managementContext });
    const list = Array.isArray(attachments) ? attachments : [];
    return Promise.resolve(list.map((attachment: { mimeType: string; data: string; name?: string }) => ({
      path: `${folder ?? ".pi-web/attachments"}/${attachment.name ?? "file.png"}`,
      mimeType: attachment.mimeType,
      size: Buffer.from(attachment.data, "base64").byteLength,
    })));
  }
}

class RejectingSessionManager implements PiSessionManagerGateway {
  readonly calls = { create: 0, list: 0, listAll: 0, open: 0 };

  list() {
    this.calls.list += 1;
    return Promise.resolve([]);
  }

  create(): never {
    this.calls.create += 1;
    throw new Error("Session manager should not create sessions for invalid prompt payloads");
  }

  listAll() {
    this.calls.listAll += 1;
    return Promise.resolve([]);
  }

  open(): never {
    this.calls.open += 1;
    throw new Error("Session manager should not open sessions for invalid prompt payloads");
  }
}

function sessionIdFromLookup(lookup: string | PiSessionRef): string {
  return typeof lookup === "string" ? lookup : lookup.id;
}

function statusForLookup(lookup: string | PiSessionRef) {
  return {
    sessionId: sessionIdFromLookup(lookup),
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function testManagementContext(): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["runtime:read", "runtime:write", "tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
  };
}

function serverUrl(instance: FastifyInstance): string {
  const address = instance.server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP server address");
  return `ws://127.0.0.1:${String(address.port)}`;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once("open", () => { resolve(); });
    socket.once("error", reject);
    socket.once("close", () => { reject(new Error("WebSocket closed before opening")); });
  });
}

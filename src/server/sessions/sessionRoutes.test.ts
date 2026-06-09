import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { PiSessionService, type PiSessionManagerGateway } from "./piSessionService.js";
import { registerSessionRoutes } from "./sessionRoutes.js";

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
    expect(response.json()).toEqual({ error: "Prompt text is required" });
    expect(sessionManager.calls).toEqual({ create: 0, list: 0, listAll: 0, open: 0 });
  });

  it("passes management embed context to prompt requests", async () => {
    const context = managementContext();
    const eventHub = new SessionEventHub();
    const sessions = new PromptCapturingSessionService(eventHub);
    const promptApp = Fastify({ logger: false });
    registerSessionRoutes(promptApp, sessions, eventHub);

    try {
      const response = await promptApp.inject({
        method: "POST",
        url: "/sessions/session-1/prompt",
        headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) },
        payload: { text: "hello", streamingBehavior: "followUp" },
      });

      expect(response.statusCode).toBe(200);
      expect(sessions.promptCalls).toEqual([["session-1", "hello", "followUp", context]]);
    } finally {
      await sessions.dispose();
      await promptApp.close();
    }
  });
});

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

class PromptCapturingSessionService extends PiSessionService {
  readonly promptCalls: unknown[][] = [];

  constructor(eventHub: SessionEventHub) {
    super(eventHub, { heartbeatIntervalMs: 60_000 });
  }

  override prompt(...args: Parameters<PiSessionService["prompt"]>): Promise<void> {
    this.promptCalls.push([...args]);
    return Promise.resolve();
  }
}

function managementContext(): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["runtime:read", "runtime:write", "tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
    tools: { allow: ["read", "write", "edit", "ls", "grep", "find", "python"], deny: ["terminal", "shell", "bash"] },
  };
}

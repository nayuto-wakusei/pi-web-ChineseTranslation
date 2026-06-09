import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { PiSessionService } from "./piSessionService.js";
import { registerSessionRoutes } from "./sessionRoutes.js";

function managementContext(): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["runtime:read", "runtime:write", "tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
    tools: { allow: ["read", "write", "edit", "ls", "grep", "find", "python"], deny: ["terminal", "shell", "bash"] },
  };
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

describe("session routes", () => {
  it("passes management embed context to prompt requests", async () => {
    const context = managementContext();
    const app = fastify();
    const eventHub = new SessionEventHub();
    const sessions = new PromptCapturingSessionService(eventHub);
    registerSessionRoutes(app, sessions, eventHub);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/session-1/prompt",
      headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) },
      payload: { text: "hello", streamingBehavior: "followUp" },
    });

    expect(response.statusCode).toBe(200);
    expect(sessions.promptCalls).toEqual([["session-1", "hello", "followUp", context]]);
    await sessions.dispose();
  });
});

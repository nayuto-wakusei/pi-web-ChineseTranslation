import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, WORKBENCH_ACCESS_HANDLE_HEADER, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";
import type { SessionProxyDaemon } from "../sessiond/sessionProxyRoutes.js";
import { registerWorkspaceDeletionRoutes } from "./workspaceDeletionRoutes.js";

let app: FastifyInstance;
let requestHeaders: Record<string, string> | undefined;
let requestSignal: AbortSignal | undefined;
let authenticatedContext: ManagementEmbedContext;
let daemonRequest: ReturnType<typeof vi.fn<SessionProxyDaemon["request"]>>;
const context: ManagementEmbedContext = {
  user: { id: "user-1", rootUserId: "root-1", roles: [], permissions: [] },
  projects: [{ id: "managed", name: "Managed" }],
};
const managementEmbed: ManagementEmbedRuntime = {
  enabled: true,
  projectRoot: "/managed",
  authenticate: () => Promise.resolve(authenticatedContext),
  resourceHandle: () => "opaque-workbench-handle",
};

beforeEach(() => {
  app = Fastify({ logger: false });
  requestHeaders = undefined;
  requestSignal = undefined;
  authenticatedContext = context;
  daemonRequest = vi.fn<SessionProxyDaemon["request"]>((_method, _path, _body, headers, signal) => {
    requestHeaders = headers;
    requestSignal = signal;
    return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) });
  });
  const daemon: SessionProxyDaemon = {
    request: daemonRequest,
    connectWebSocket: () => { throw new Error("WebSocket not configured for test"); },
  };
  registerWorkspaceDeletionRoutes(app, daemon, "/api", managementEmbed);
});

afterEach(async () => {
  await app.close();
});

describe("workspace deletion proxy management context", () => {
  it("forwards the management context and opaque Workbench handle", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/api/projects/managed/workspaces/feature?embed=management&token=entry-token",
      payload: { precondition: "feature" },
    });

    expect(response.statusCode).toBe(200);
    expect(decodeManagementContext(requestHeaders?.[MANAGEMENT_EMBED_CONTEXT_HEADER])).toEqual(context);
    expect(requestHeaders?.[WORKBENCH_ACCESS_HANDLE_HEADER]).toBe("opaque-workbench-handle");
    expect(requestSignal).toBeInstanceOf(AbortSignal);
  });

  it("rejects removal when the signed allowlist excludes command runs", async () => {
    authenticatedContext = { ...context, tools: { allow: ["read"] } };

    const response = await app.inject({
      method: "DELETE",
      url: "/api/projects/managed/workspaces/feature?embed=management&token=entry-token",
      payload: { precondition: "feature" },
    });

    expect(response.statusCode).toBe(403);
    expect(daemonRequest).not.toHaveBeenCalled();
  });
});

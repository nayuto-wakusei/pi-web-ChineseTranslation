import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, WORKBENCH_ACCESS_HANDLE_HEADER, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";
import type { SessionProxyDaemon } from "../sessiond/sessionProxyRoutes.js";
import { registerWorkspaceDeletionRoutes } from "./workspaceDeletionRoutes.js";

let app: FastifyInstance;
let requestHeaders: Record<string, string> | undefined;
const context: ManagementEmbedContext = {
  user: { id: "user-1", rootUserId: "root-1", roles: [], permissions: [] },
  projects: [{ id: "managed", name: "Managed" }],
};
const managementEmbed: ManagementEmbedRuntime = {
  enabled: true,
  projectRoot: "/managed",
  authenticate: () => Promise.resolve(context),
  resourceHandle: () => "opaque-workbench-handle",
};

beforeEach(() => {
  app = Fastify({ logger: false });
  requestHeaders = undefined;
  const daemon: SessionProxyDaemon = {
    request: (_method, _path, _body, headers) => {
      requestHeaders = headers;
      return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) });
    },
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
  });
});

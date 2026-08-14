import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, WORKBENCH_ACCESS_HANDLE_HEADER, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";
import { registerPluginBackendProxyRoutes } from "./pluginBackendProxyRoutes.js";

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
  registerPluginBackendProxyRoutes(app, {
    request: (_method, _path, _body, headers) => {
      requestHeaders = headers;
      return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) });
    },
  }, "/api/plugin-backends", managementEmbed);
});

afterEach(async () => {
  await app.close();
});

describe("plugin backend proxy management context", () => {
  it("forwards the management context and opaque Workbench handle", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/plugin-backends/git/projects/managed/workspaces/main/list?embed=management&token=entry-token",
      payload: { revision: "v1", input: {} },
    });

    expect(response.statusCode).toBe(200);
    expect(decodeManagementContext(requestHeaders?.[MANAGEMENT_EMBED_CONTEXT_HEADER])).toEqual(context);
    expect(requestHeaders?.[WORKBENCH_ACCESS_HANDLE_HEADER]).toBe("opaque-workbench-handle");
  });
});

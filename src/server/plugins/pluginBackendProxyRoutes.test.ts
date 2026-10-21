import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, WORKBENCH_ACCESS_HANDLE_HEADER, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";
import type { SessionDaemonRequestClient } from "../../sessiond/sessionDaemonClient.js";
import { registerPairedPluginBackendProxyRoutes, registerPluginBackendProxyRoutes } from "./pluginBackendProxyRoutes.js";

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
      requestHeaders = headers === undefined ? undefined : capturedHeaders(headers);
      return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) });
    },
  }, "/api", managementEmbed);
});

function capturedHeaders(value: Record<string, string> | import("../../sessiond/sessionDaemonClient.js").SessionDaemonRequestOptions): Record<string, string> {
  if ("headers" in value && typeof value.headers === "object") return value.headers;
  return Object.fromEntries(Object.entries(value).map(([key, header]) => {
    if (typeof header !== "string") throw new Error("Expected forwarded request headers");
    return [key, header];
  }));
}

afterEach(async () => {
  await app.close();
});

describe("plugin backend proxy management context", () => {
  it.each(["/paired-plugin-backends/git/list", "/paired-plugin-backends/git/projects/managed/list"])("rejects management requests outside workspace scope: %s", async (path) => {
    const response = await app.inject({ method: "POST", url: `/api${path}?embed=management&token=entry-token`, payload: { revision: "v1", input: {} } });
    expect(response.statusCode).toBe(403);
    expect(requestHeaders).toBeUndefined();
  });
  it("forwards the management context and opaque Workbench handle", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/paired-plugin-backends/git/projects/managed/workspaces/main/list?embed=management&token=entry-token",
      payload: { revision: "v1", input: {} },
    });

    expect(response.statusCode).toBe(200);
    expect(decodeManagementContext(requestHeaders?.[MANAGEMENT_EMBED_CONTEXT_HEADER])).toEqual(context);
    expect(requestHeaders?.[WORKBENCH_ACCESS_HANDLE_HEADER]).toBe("opaque-workbench-handle");
  });
});

describe("local paired plugin backend proxy route", () => {
  let request: ReturnType<typeof vi.fn<SessionDaemonRequestClient["request"]>>;
  beforeEach(async () => {
    await app.close();
    app = Fastify({ logger: false });
    request = vi.fn<SessionDaemonRequestClient["request"]>(() => Promise.resolve({
      statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ counts: { open: 2 } }),
    }));
    registerPairedPluginBackendProxyRoutes(app, { request });
  });
  it("forwards machine and project scoped envelopes without inventing workspace authority", async () => {
    for (const scope of ["machine", "project"] as const) {
      const path = scope === "machine" ? "/paired-plugin-backends/board/cards.summary" : "/paired-plugin-backends/board/projects/project%2Fone/cards.summary";
      const payload = { scope, revision: "r1", input: null };
      const response = await app.inject({ method: "POST", url: `/api${path}`, payload });
      expect(response.statusCode).toBe(200);
      expect(request.mock.calls.at(-1)?.slice(0, 3)).toEqual(["POST", path, payload]);
    }
  });
  it("encodes every daemon path segment and forwards the JSON envelope once", async () => {
    const payload = { revision: "server-r1", input: { cards: ["alpha", "beta"] } };
    const response = await app.inject({
      method: "POST",
      url: "/api/paired-plugin-backends/board/projects/project%20one/workspaces/workspace%231/cards.summary",
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({ counts: { open: 2 } });
    expect(request.mock.calls[0]?.slice(0, 3)).toEqual([
      "POST",
      "/paired-plugin-backends/board/projects/project%20one/workspaces/workspace%231/cards.summary",
      payload,
    ]);
    expect(request.mock.calls[0]?.[4]).toBeInstanceOf(AbortSignal);
  });

  it("preserves JSON primitives and attributable upstream failures", async () => {
    request
      .mockResolvedValueOnce({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify("ready") })
      .mockResolvedValueOnce({
        statusCode: 501,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "operation unavailable", code: "operation-unavailable", pluginId: "board", operation: "cards.summary" }),
      });

    const success = await app.inject({ method: "POST", url: "/api/paired-plugin-backends/board/projects/p1/workspaces/w1/cards.summary", payload: { revision: "r1", input: null } });
    const failure = await app.inject({ method: "POST", url: "/api/paired-plugin-backends/board/projects/p1/workspaces/w1/cards.summary", payload: { revision: "r1", input: null } });

    expect(success.json()).toBe("ready");
    expect(failure.statusCode).toBe(501);
    expect(failure.json()).toEqual({ error: "operation unavailable", code: "operation-unavailable", pluginId: "board", operation: "cards.summary" });
  });

  it("does not register the retired owner-backed route", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/plugin-backends/board/projects/p1/workspaces/w1/cards.summary",
      payload: { revision: "r1", input: null },
    });

    expect(response.statusCode).toBe(404);
    expect(request).not.toHaveBeenCalled();
  });

  it("maps daemon transport loss and an old daemon route to explicit gateway errors", async () => {
    request
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce({
        statusCode: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Route POST:/paired-plugin-backends/board not found", error: "Not Found", statusCode: 404 }),
      });

    const unavailable = await app.inject({ method: "POST", url: "/api/paired-plugin-backends/board/projects/p1/workspaces/w1/cards.summary", payload: { revision: "r1", input: null } });
    const unsupported = await app.inject({ method: "POST", url: "/api/paired-plugin-backends/board/projects/p1/workspaces/w1/cards.summary", payload: { revision: "r1", input: null } });

    expect(unavailable.statusCode).toBe(502);
    expect(unavailable.json()).toMatchObject({ code: "daemon-unavailable", pluginId: "board", operation: "cards.summary" });
    expect(unsupported.statusCode).toBe(502);
    expect(unsupported.json()).toMatchObject({ code: "daemon-protocol-error" });
    expect(unsupported.json<{ error: string }>().error).toContain("restart or upgrade");
  });
});

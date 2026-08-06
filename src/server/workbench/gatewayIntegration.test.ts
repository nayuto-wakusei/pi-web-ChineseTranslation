import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeManagementContext, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";
import { createWorkbenchManagementRuntime } from "./gatewayIntegration.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workbench management runtime", () => {
  it("exchanges the bootstrap token server-side and forwards only an opaque handle with the management context", async () => {
    const context: ManagementEmbedContext = {
      user: { id: "user-1", rootUserId: "user-1", roles: [], permissions: [] },
      projects: [{ id: "personal-project", name: "个人项目" }],
    };
    const base: ManagementEmbedRuntime = {
      enabled: true,
      projectRoot: "/managed",
      authenticate: vi.fn(() => Promise.resolve(context)),
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(201, { sessionId: "session-1", token: "private-agent-token", expiresAt: "2099-01-01T00:00:00.000Z", authorizationRevision: 12 }))
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "session-1", authorizationRevision: 12, resources: [] })));
    const request = vi.fn(() => Promise.resolve({ statusCode: 204, headers: {}, body: "" }));
    const runtime = createWorkbenchManagementRuntime(base, {
      baseUrl: "http://backend:8787",
      mcpUrl: "http://mcp:8000/mcp",
      requestTimeoutMs: 10_000,
    }, { request, connectWebSocket: () => { throw new Error("not used"); } });

    const authenticated = await runtime?.authenticate("bootstrap-secret");
    const handle = authenticated === undefined ? undefined : runtime?.resourceHandle?.(authenticated);

    expect(handle).toMatch(/^[A-Za-z0-9_-]+$/u);
    if (handle === undefined) throw new Error("Expected an opaque resource handle");
    expect(request).toHaveBeenCalledWith("PUT", expect.stringContaining(handle), expect.objectContaining({ bearerToken: "private-agent-token" }));
    expect(encodeManagementContext(context)).not.toContain("private-agent-token");
    expect(JSON.stringify(context)).not.toContain(handle);
  });

  it("reuses one Agent Session for concurrent requests carrying the same entry token", async () => {
    const base: ManagementEmbedRuntime = {
      enabled: true,
      projectRoot: "/managed",
      authenticate: vi.fn(() => Promise.resolve<ManagementEmbedContext>({
        user: { id: "user-1", rootUserId: "user-1", roles: [], permissions: [] },
        projects: [{ id: "personal-project", name: "个人项目" }],
        expiresAt: "2099-01-01T00:00:00.000Z",
      })),
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(201, { sessionId: "session-1", token: "private-agent-token", expiresAt: "2099-01-01T00:00:00.000Z", authorizationRevision: 12 }))
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "session-1", authorizationRevision: 12, resources: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const request = vi.fn(() => Promise.resolve({ statusCode: 204, headers: {}, body: "" }));
    const runtime = createWorkbenchManagementRuntime(base, {
      baseUrl: "http://backend:8787",
      mcpUrl: "http://mcp:8000/mcp",
      requestTimeoutMs: 10_000,
    }, { request, connectWebSocket: () => { throw new Error("not used"); } });

    const contexts = await Promise.all([
      runtime?.authenticate("same-bootstrap-token"),
      runtime?.authenticate("same-bootstrap-token"),
      runtime?.authenticate("same-bootstrap-token"),
    ]);
    const handles = contexts.map((context) => context === undefined ? undefined : runtime?.resourceHandle?.(context));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
    expect(new Set(handles).size).toBe(1);
  });
});

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

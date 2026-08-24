import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeManagementContext, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";
import type { SessionProxyDaemon } from "../sessiond/sessionProxyRoutes.js";
import { createWorkbenchManagementRuntime } from "./gatewayIntegration.js";

afterEach(() => {
  vi.useRealTimers();
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

  it("renews an expired Agent Session behind the same opaque handle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-21T15:59:00.000Z");
    const context: ManagementEmbedContext = {
      user: { id: "user-1", rootUserId: "user-1", roles: [], permissions: [] },
      projects: [{ id: "personal-project", name: "个人项目" }],
      expiresAt: "2026-08-22T15:59:00.000Z",
    };
    const base: ManagementEmbedRuntime = {
      enabled: true,
      projectRoot: "/managed",
      authenticate: vi.fn(() => Promise.resolve(context)),
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(201, { sessionId: "session-1", token: "agent-token-1", expiresAt: "2026-08-21T16:00:00.000Z", authorizationRevision: 12 }))
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "session-1", authorizationRevision: 12, resources: [] }))
      .mockResolvedValueOnce(jsonResponse(201, { sessionId: "session-2", token: "agent-token-2", expiresAt: "2026-08-21T17:01:00.000Z", authorizationRevision: 12 }))
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "session-2", authorizationRevision: 12, resources: [] })));
    const request = vi.fn<SessionProxyDaemon["request"]>(() => Promise.resolve({ statusCode: 204, headers: {}, body: "" }));
    const runtime = createWorkbenchManagementRuntime(base, {
      baseUrl: "http://backend:8787",
      mcpUrl: "http://mcp:8000/mcp",
      requestTimeoutMs: 10_000,
    }, { request, connectWebSocket: () => { throw new Error("not used"); } });

    const authenticated = await runtime?.authenticate("bootstrap-secret");
    if (authenticated === undefined) throw new Error("Expected an authenticated context");
    const handle = runtime?.resourceHandle?.(authenticated);
    vi.setSystemTime("2026-08-21T16:01:00.000Z");
    await runtime?.prepareContext?.(authenticated);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toBe(request.mock.calls[0]?.[1]);
    expect(request.mock.calls[1]?.[2]).toEqual(expect.objectContaining({ bearerToken: "agent-token-2" }));
    expect(runtime?.resourceHandle?.(authenticated)).toBe(handle);
  });

  it("does not renew Agent Session access after the entry authorization expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-21T15:59:00.000Z");
    const context: ManagementEmbedContext = {
      user: { id: "user-1", rootUserId: "user-1", roles: [], permissions: [] },
      projects: [{ id: "personal-project", name: "个人项目" }],
      expiresAt: "2026-08-21T16:00:00.000Z",
    };
    const base: ManagementEmbedRuntime = {
      enabled: true,
      projectRoot: "/managed",
      authenticate: vi.fn(() => Promise.resolve(context)),
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(201, { sessionId: "session-1", token: "agent-token-1", expiresAt: "2026-08-21T16:00:00.000Z", authorizationRevision: 12 }))
      .mockResolvedValueOnce(jsonResponse(200, { sessionId: "session-1", authorizationRevision: 12, resources: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const request = vi.fn(() => Promise.resolve({ statusCode: 204, headers: {}, body: "" }));
    const runtime = createWorkbenchManagementRuntime(base, {
      baseUrl: "http://backend:8787",
      mcpUrl: "http://mcp:8000/mcp",
      requestTimeoutMs: 10_000,
    }, { request, connectWebSocket: () => { throw new Error("not used"); } });

    const authenticated = await runtime?.authenticate("bootstrap-secret");
    if (authenticated === undefined) throw new Error("Expected an authenticated context");
    vi.setSystemTime("2026-08-21T16:01:00.000Z");

    await expect(runtime?.prepareContext?.(authenticated)).rejects.toThrow("请返回工作台重新进入桂小智");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

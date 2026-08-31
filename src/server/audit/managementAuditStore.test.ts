import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagementAuditStore, managementAuditIndexName, type ManagementAuditEvent } from "./managementAuditStore.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("ManagementAuditStore", () => {
  it("uses Shanghai calendar ISO weeks for index names", () => {
    expect(managementAuditIndexName("pi-web-management-audit", new Date("2026-08-06T00:00:00.000Z"))).toBe("pi-web-management-audit-2026-w32");
    expect(managementAuditIndexName("pi-web-management-audit", new Date("2021-01-03T15:59:59.000Z"))).toBe("pi-web-management-audit-2020-w53");
    expect(managementAuditIndexName("pi-web-management-audit", new Date("2021-01-03T16:00:00.000Z"))).toBe("pi-web-management-audit-2021-w01");
  });

  it("writes complete management content through the bulk API", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ acknowledged: true }))
      .mockResolvedValueOnce(jsonResponse({ deleted: 0 }))
      .mockResolvedValueOnce(jsonResponse({ errors: false, items: [] }));
    const store = new ManagementAuditStore({
      baseUrl: "http://elasticsearch:9200",
      indexPrefix: "pi-web-management-audit",
      retentionDays: 365,
      apiKey: "private-api-key",
      fetch: fetchImpl,
      now: () => new Date("2026-08-06T01:02:03.000Z"),
      flushIntervalMs: 0,
      maintenanceIntervalMs: 0,
    });

    await store.initialize();
    store.record({ ...toolEvent(), content: { path: "/workspace", includeHidden: true } });
    await store.flush();

    const [url, init] = fetchImpl.mock.calls[2] ?? [];
    expect(requestUrl(url)).toBe("http://elasticsearch:9200/_bulk");
    expect(new Headers(init?.headers).get("authorization")).toBe("ApiKey private-api-key");
    const body = requestBody(init?.body);
    const lines = body.trim().split("\n").map((line): unknown => JSON.parse(line));
    expect(lines[0]).toMatchObject({ index: { _index: "pi-web-management-audit-2026-w32" } });
    expect(lines[1]).toMatchObject({
      "@timestamp": "2026-08-06T01:02:03.000Z",
      event: { action: "tool_execution", status: "completed" },
      user: { id: "user-1", root_user_id: "root-1", name: "测试用户" },
      project: { id: "project-1" },
      session: { id: "session-1" },
      tool: { name: "read", call_id: "call-1" },
      content: { path: "/workspace", includeHidden: true },
    });
    expect(body).not.toContain("private-api-key");

    await store.close();
  });

  it("runs retention deletion once per Shanghai calendar month", async () => {
    let now = new Date("2026-08-06T00:00:00.000Z");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ acknowledged: true, deleted: 0 }));
    const store = new ManagementAuditStore({
      baseUrl: "http://elasticsearch:9200/base/",
      indexPrefix: "managed-audit",
      retentionDays: 365,
      fetch: fetchImpl,
      now: () => now,
      maintenanceIntervalMs: 0,
    });

    await store.initialize();
    await store.maintain();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, firstDelete] = fetchImpl.mock.calls;
    expect(requestUrl(firstDelete?.[0])).toBe("http://elasticsearch:9200/base/managed-audit-*/_delete_by_query?conflicts=proceed&refresh=false");
    expect(JSON.parse(requestBody(firstDelete?.[1]?.body))).toEqual({ query: { range: { "@timestamp": { lt: "2025-08-06T00:00:00.000Z" } } } });

    now = new Date("2026-09-01T00:00:00.000Z");
    await store.maintain();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await store.close();
  });

  it("indexes Workbench knowledge retrieval metadata without retrieval content", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ acknowledged: true }))
      .mockResolvedValueOnce(jsonResponse({ deleted: 0 }))
      .mockResolvedValueOnce(jsonResponse({ errors: false, items: [] }));
    const store = new ManagementAuditStore({
      baseUrl: "http://elasticsearch:9200",
      indexPrefix: "pi-web-management-audit",
      retentionDays: 365,
      fetch: fetchImpl,
      now: () => new Date("2026-08-06T01:02:03.000Z"),
      flushIntervalMs: 0,
      maintenanceIntervalMs: 0,
    });

    await store.initialize();
    store.record({
      action: "workbench_knowledge_retrieval",
      status: "completed",
      userId: "user-1",
      rootUserId: "root-1",
      projectId: "project-1",
      sessionId: "session-1",
      cwd: "/workspace",
      agentSessionId: "agent-session-1",
      authorizationRevision: 12,
      knowledgeName: "knowledge.nanning.optical",
      knowledgeVersion: "r3",
      runId: "run-1",
      traceId: "trace-1",
      statusCode: 200,
      durationMs: 34,
      resultCount: 2,
    });
    await store.flush();

    const body = requestBody(fetchImpl.mock.calls[2]?.[1]?.body);
    const lines = body.trim().split("\n").map((line): unknown => JSON.parse(line));
    expect(lines[1]).toMatchObject({
      event: { action: "workbench_knowledge_retrieval", status: "completed", duration_ms: 34 },
      workbench: {
        authorization_revision: 12,
        knowledge_name: "knowledge.nanning.optical",
        knowledge_version: "r3",
        run_id: "run-1",
        trace_id: "trace-1",
        status_code: "200",
        result_count: 2,
      },
    });
    expect(body).not.toContain("private-knowledge-token");
    expect(body).not.toContain("sensitive original query");
    expect(body).not.toContain("private chunk body");

    await store.close();
  });

  it("retries an idempotent batch after a transport failure", async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse({ errors: false, items: [] }));
    const store = new ManagementAuditStore({
      baseUrl: "http://elasticsearch:9200",
      indexPrefix: "managed-audit",
      retentionDays: 365,
      fetch: fetchImpl,
      flushIntervalMs: 60_000,
      maintenanceIntervalMs: 0,
      onError,
    });

    store.record(toolEvent());
    await expect(store.flush()).rejects.toThrow("offline");
    await expect(store.flush()).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(fetchImpl.mock.calls[1]?.[1]?.body);
    await store.close();
  });
});

function toolEvent(): ManagementAuditEvent {
  return {
    action: "tool_execution",
    status: "completed",
    userId: "user-1",
    rootUserId: "root-1",
    userDisplayName: "测试用户",
    projectId: "project-1",
    sessionId: "session-1",
    cwd: "/workspace",
    toolName: "read",
    toolCallId: "call-1",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function requestUrl(input: string | URL | Request | undefined): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  throw new Error("Expected a request URL");
}

function requestBody(body: BodyInit | null | undefined): string {
  if (typeof body === "string") return body;
  throw new Error("Expected a string request body");
}

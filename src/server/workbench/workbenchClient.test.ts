import { describe, expect, it, vi } from "vitest";
import { WorkbenchClient } from "./workbenchClient.js";

describe("WorkbenchClient", () => {
  it("creates a private Agent Session and loads its matching resource snapshot", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(201, { sessionId: "session-1", token: "agent-secret", expiresAt: "2099-01-01T00:00:00.000Z", authorizationRevision: 12 }))
      .mockResolvedValueOnce(jsonResponse(200, {
        sessionId: "session-1",
        authorizationRevision: 12,
        resources: [{
          resourceType: "capability", resourceName: "e2e.echo", resourceVersion: "2", source: "group", riskLevel: "L0", status: "published",
          displayName: "Echo", description: "", dependencies: [], metadata: { inputSchema: {} },
        }],
      }));
    const client = new WorkbenchClient({ baseUrl: "http://backend:8787", requestTimeoutMs: 10_000, fetch: fetchImpl });

    const state = await client.createAgentAccessState("bootstrap-secret", "personal-project");

    expect(state).toMatchObject({ sessionId: "session-1", bearerToken: "agent-secret", authorizationRevision: 12 });
    const [sessionUrl, sessionInit] = fetchImpl.mock.calls[0] ?? [];
    const [resourcesUrl, resourcesInit] = fetchImpl.mock.calls[1] ?? [];
    expect(sessionUrl).toEqual(new URL("http://backend:8787/api/agent-access/sessions"));
    expect(sessionInit?.method).toBe("POST");
    expect(new Headers(sessionInit?.headers).get("authorization")).toBe("Bearer bootstrap-secret");
    expect(sessionInit?.body).toBe(JSON.stringify({ projectId: "personal-project", regions: [] }));
    expect(resourcesUrl).toEqual(new URL("http://backend:8787/api/agent-access/resources"));
    expect(new Headers(resourcesInit?.headers).get("authorization")).toBe("Bearer agent-secret");
  });

  it("issues knowledge tokens and retrieves through the workbench backend", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { token: "knowledge-secret" }))
      .mockResolvedValueOnce(jsonResponse(200, {
        total: 1,
        resourceName: "knowledge.nanning.asset-1",
        resourceVersion: "r3",
        chunks: [{
          id: "chunk-1",
          documentId: "doc-1",
          documentName: "手册.pdf",
          content: "处理步骤",
          similarity: 0.91,
          position: [[1, 2, 3]],
          version: "r3",
          source: "网操中心",
          citation: "knowledge://knowledge.nanning.asset-1@r3/doc-1/chunk-1",
        }],
      }));
    const client = new WorkbenchClient({ baseUrl: "http://backend:8787", requestTimeoutMs: 10_000, fetch: fetchImpl });

    const token = await client.issueKnowledgeToken("agent-secret", {
      resourceName: "knowledge.nanning.asset-1",
      resourceVersion: "r3",
      runId: "run-1",
      traceId: "trace-1",
    });
    const result = await client.retrieveKnowledge(token, {
      question: "光衰如何处理",
      resourceName: "knowledge.nanning.asset-1",
      topK: 8,
      filters: { document_type: "manual" },
    });

    expect(token).toBe("knowledge-secret");
    expect(result.chunks[0]?.citation).toBe("knowledge://knowledge.nanning.asset-1@r3/doc-1/chunk-1");
    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0] ?? [];
    const [retrievalUrl, retrievalInit] = fetchImpl.mock.calls[1] ?? [];
    expect(tokenUrl).toEqual(new URL("http://backend:8787/api/agent-access/knowledge-token"));
    expect(new Headers(tokenInit?.headers).get("authorization")).toBe("Bearer agent-secret");
    expect(tokenInit?.body).toBe(JSON.stringify({
      resourceName: "knowledge.nanning.asset-1",
      resourceVersion: "r3",
      runId: "run-1",
      traceId: "trace-1",
    }));
    expect(retrievalUrl).toEqual(new URL("http://backend:8787/api/knowledge-access/retrieval"));
    expect(new Headers(retrievalInit?.headers).get("authorization")).toBe("Bearer knowledge-secret");
    expect(retrievalInit?.body).toBe(JSON.stringify({
      question: "光衰如何处理",
      resourceName: "knowledge.nanning.asset-1",
      topK: 8,
      filters: { document_type: "manual" },
    }));
  });
});

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

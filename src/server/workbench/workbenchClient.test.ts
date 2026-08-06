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
});

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

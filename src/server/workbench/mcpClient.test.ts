import { describe, expect, it, vi } from "vitest";
import { McpTransportError, parseMcpPayload, parseStableCapabilityResult, WorkbenchMcpClient } from "./mcpClient.js";

const stableResult = {
  ok: true,
  capability_name: "e2e.echo",
  status_code: 200,
  data: { echoed: true },
  error: null,
  meta: { trace_id: "mcp-trace", duration_ms: 12, truncated: false },
};

function initializeResponse(sessionId?: string, protocolVersion = "2025-06-18"): Response {
  return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion, capabilities: {}, serverInfo: { name: "test", version: "1.0.0" } } },
    { headers: sessionId === undefined ? {} : { "mcp-session-id": sessionId } });
}

describe("MCP response parsing", () => {
  it("parses JSON and SSE JSON-RPC envelopes", () => {
    const envelope = { jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify(stableResult) }] } };
    expect(parseMcpPayload(JSON.stringify(envelope), "application/json")).toEqual(envelope);
    expect(parseMcpPayload(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`, "text/event-stream")).toEqual(envelope);
  });

  it("extracts and validates the stable capability result", () => {
    expect(parseStableCapabilityResult({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: JSON.stringify(stableResult) }] },
    })).toEqual(stableResult);
  });

  it("rejects non-JSON tool text", () => {
    expect(() => parseStableCapabilityResult({ result: { content: [{ type: "text", text: "not-json" }] } })).toThrow("not valid JSON");
  });

  it("reports a safe transport category without exposing the capability token", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 10.0.0.8:30033"), { code: "ECONNREFUSED" });
    const fetchImpl: typeof fetch = vi.fn(() => Promise.reject(new TypeError("fetch failed", { cause })));
    const client = new WorkbenchMcpClient({ mcpUrl: "http://private-mcp/mcp", timeoutMs: 1_000, fetch: fetchImpl });

    let failure: unknown;
    try {
      await client.callCapability("private-capability-token", "allowed.read", {});
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(McpTransportError);
    expect(failure).toMatchObject({ code: "ECONNREFUSED", message: "MCP 通道连接失败（ECONNREFUSED）" });
    expect(String(failure)).not.toContain("private-capability-token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("deletes a stateful session after success and preserves the result if cleanup fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(initializeResponse("session"))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ result: { content: [{ type: "text", text: JSON.stringify(stableResult) }] } }))
      .mockRejectedValueOnce(new Error("cleanup unavailable"));
    const client = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000, fetch: fetchImpl });
    expect(await client.callCapability("ticket", "e2e.echo", {})).toEqual(stableResult);
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST", "POST", "DELETE"]);
    const cleanup = fetchImpl.mock.calls[3]?.[1];
    expect(new Headers(cleanup?.headers).get("mcp-session-id")).toBe("session");
    expect(cleanup?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    { sessionId: undefined, protocolVersion: "2025-06-18" },
    { sessionId: "", protocolVersion: "2025-03-26" },
    { sessionId: "session", protocolVersion: "2025-03-26" },
  ])("uses the negotiated protocol with optional session identity ($sessionId, $protocolVersion)", async ({ sessionId, protocolVersion }) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(initializeResponse(sessionId, protocolVersion))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ result: { content: [{ type: "text", text: JSON.stringify(stableResult) }] } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000, fetch: fetchImpl });
    expect(await client.callCapability("ticket", "e2e.echo", {})).toEqual(stableResult);
    const hasSession = sessionId !== undefined && sessionId !== "";
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(hasSession ? ["POST", "POST", "POST", "DELETE"] : ["POST", "POST", "POST"]);
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has("mcp-protocol-version")).toBe(false);
    for (const [, init] of fetchImpl.mock.calls.slice(1)) {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer ticket");
      expect(headers.get("mcp-protocol-version")).toBe(protocolVersion);
      expect(headers.get("mcp-session-id")).toBe(hasSession ? sessionId : null);
    }
  });

  it("accepts a stateless SSE initialize response", async () => {
    const envelope = { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`, { headers: { "content-type": "text/event-stream" } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ result: { content: [{ type: "text", text: JSON.stringify(stableResult) }] } }));
    const client = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000, fetch: fetchImpl });
    expect(await client.callCapability("ticket", "e2e.echo", {})).toEqual(stableResult);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    { payload: { result: { protocolVersion: "2099-01-01" } }, message: "Unsupported MCP protocol version" },
    { payload: { result: {} }, message: "protocolVersion must be a non-empty string" },
    { payload: { error: { code: -32603, message: "initialize failed" } }, message: "MCP JSON-RPC error: initialize failed" },
  ])("rejects invalid negotiation before issuing any tools/call ($message)", async ({ payload, message }) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload, { headers: { "mcp-session-id": "session" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000, fetch: fetchImpl });
    await expect(client.callCapability("ticket", "e2e.echo", {})).rejects.toThrow(message);
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "DELETE"]);
  });

  it.each(["session", undefined])("propagates cancellation and releases only an issued session (%s)", async (sessionId) => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(initializeResponse(sessionId))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockImplementationOnce(async (_url, init) => {
        entered();
        return new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => { reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error("aborted")); }, { once: true }); });
      })
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000, fetch: fetchImpl });
    const running = client.callCapability("ticket", "e2e.echo", {}, undefined, controller.signal);
    const rejected = expect(running).rejects.toThrow("user cancelled");
    await started;
    controller.abort(new Error("user cancelled"));
    await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(sessionId === undefined ? 3 : 4);
    if (sessionId !== undefined) {
      expect(fetchImpl.mock.calls[3]?.[1]?.method).toBe("DELETE");
      expect(fetchImpl.mock.calls[3]?.[1]?.signal?.aborted).toBe(false);
    }
  });

  it.each(["session", undefined])("never marks unknown tools/call execution as safe to replay (%s)", async (sessionId) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(initializeResponse(sessionId))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockRejectedValueOnce(new Error("response lost after query started"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000, fetch: fetchImpl });
    await expect(client.callCapability("ticket", "e2e.echo", {})).rejects.toMatchObject({ safeToRetry: false });
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(sessionId === undefined ? ["POST", "POST", "POST"] : ["POST", "POST", "POST", "DELETE"]);
  });

  it("uses one deadline across admission and all network stages", async () => {
    let budget: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.signal?.aborted).toBe(false);
      return new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => { reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error("aborted")); }, { once: true }); });
    });
    const client = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 30, fetch: fetchImpl });
    const operation = client.withCapacity("user", async signal => {
      budget = signal;
      return client.callCapability("ticket", "e2e.echo", {}, undefined, signal);
    });
    await expect(operation).rejects.toThrow();
    expect(budget?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("releases a session even when the initialize body fails after its headers arrive", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error("body lost")); } }), { headers: { "mcp-session-id": "session" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000, fetch: fetchImpl });
    await expect(client.callCapability("ticket", "e2e.echo", {})).rejects.toMatchObject({ safeToRetry: true });
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("bounds cleanup time even when the server never acknowledges DELETE", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(initializeResponse("session"))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ result: { content: [{ type: "text", text: JSON.stringify(stableResult) }] } }))
      .mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error("aborted")); }, { once: true });
      }));
    const client = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000, cleanupTimeoutMs: 10, fetch: fetchImpl });
    expect(await client.callCapability("ticket", "e2e.echo", {})).toEqual(stableResult);
    expect(fetchImpl.mock.calls[3]?.[1]?.signal?.aborted).toBe(true);
  });

  it("preserves Retry-After for safe handshake failures", async () => {
    const client = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("busy", { status: 503, headers: { "retry-after": "2" } })) });
    await expect(client.callCapability("ticket", "e2e.echo", {})).rejects.toMatchObject({ status: 503, retryAfterMs: 2_000, safeToRetry: true });
  });
});

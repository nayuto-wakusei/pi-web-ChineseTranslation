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
});

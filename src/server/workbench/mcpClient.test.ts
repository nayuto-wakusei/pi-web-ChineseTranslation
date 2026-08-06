import { describe, expect, it } from "vitest";
import { parseMcpPayload, parseStableCapabilityResult } from "./mcpClient.js";

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
});

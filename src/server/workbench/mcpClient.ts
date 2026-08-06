import type { StableCapabilityResult } from "./types.js";
import { isRecord, record, stringField } from "./workbenchClient.js";

export class McpHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface WorkbenchMcpClientOptions {
  mcpUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export class WorkbenchMcpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WorkbenchMcpClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async callCapability(token: string, capabilityName: string, args: Record<string, unknown>, idempotencyKey?: string): Promise<StableCapabilityResult> {
    const initialized = await this.rpc(token, undefined, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pi-web-workbench-adapter", version: "1.0.0" } },
    });
    const sessionId = initialized.headers.get("mcp-session-id");
    if (sessionId === null || sessionId.trim() === "") throw new Error("MCP initialize response did not include mcp-session-id");
    await this.rpc(token, sessionId, { jsonrpc: "2.0", method: "notifications/initialized" }, false);
    const response = await this.rpc(token, sessionId, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "icnoc_call_capability",
        arguments: {
          capability_name: capabilityName,
          arguments: args,
          ...(idempotencyKey === undefined ? {} : { idempotency_key: idempotencyKey }),
        },
      },
    });
    return parseStableCapabilityResult(response.value);
  }

  private async rpc(token: string, sessionId: string | undefined, body: unknown, expectBody = true): Promise<{ headers: Headers; value: unknown }> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
    };
    const response = await this.fetchImpl(this.options.mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new McpHttpError(response.status, mcpErrorMessage(text, response.status));
    return { headers: response.headers, value: expectBody ? parseMcpPayload(text, response.headers.get("content-type")) : undefined };
  }
}

export function parseMcpPayload(text: string, contentType: string | null): unknown {
  if (contentType?.toLocaleLowerCase().includes("text/event-stream") === true) {
    const messages = text.split(/\r?\n\r?\n/u).flatMap((event) => {
      const data = event.split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      return data === "" ? [] : [parseJson(data)];
    });
    const message = messages.find((value) => isRecord(value) && (value["result"] !== undefined || value["error"] !== undefined));
    if (message === undefined) throw new Error("MCP SSE response did not contain a JSON-RPC result");
    return message;
  }
  try {
    return parseJson(text);
  } catch {
    throw new Error("MCP response was not valid JSON");
  }
}

export function parseStableCapabilityResult(payload: unknown): StableCapabilityResult {
  const envelope = record(payload, "MCP JSON-RPC response");
  if (envelope["error"] !== undefined) throw new Error(jsonRpcError(envelope["error"]));
  const result = record(envelope["result"], "MCP tool result");
  const content = result["content"];
  if (!Array.isArray(content)) throw new Error("MCP tool result content must be an array");
  const text = content.map((entry) => isRecord(entry) && entry["type"] === "text" && typeof entry["text"] === "string" ? entry["text"] : undefined)
    .find((entry): entry is string => entry !== undefined);
  if (text === undefined) throw new Error("MCP tool result did not include text content");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("MCP capability result text was not valid JSON");
  }
  const stable = record(value, "MCP capability result");
  const errorValue = stable["error"];
  const meta = record(stable["meta"], "MCP capability result meta");
  return {
    ok: booleanField(stable, "ok"),
    capability_name: stringField(stable, "capability_name"),
    status_code: integerField(stable, "status_code"),
    data: stable["data"],
    error: errorValue === null ? null : parseCapabilityError(errorValue),
    meta: {
      trace_id: stringField(meta, "trace_id"),
      duration_ms: integerField(meta, "duration_ms"),
      truncated: booleanField(meta, "truncated"),
    },
  };
}

function parseCapabilityError(value: unknown): NonNullable<StableCapabilityResult["error"]> {
  const error = record(value, "MCP capability error");
  return { code: stringField(error, "code"), message: stringField(error, "message"), retryable: booleanField(error, "retryable") };
}

function mcpErrorMessage(text: string, status: number): string {
  try {
    const value = parseJson(text);
    if (isRecord(value) && typeof value["error"] === "string") return `MCP HTTP ${String(status)}: ${value["error"]}`;
  } catch { /* response is not JSON */ }
  return `MCP HTTP ${String(status)}`;
}

function jsonRpcError(value: unknown): string {
  if (!isRecord(value)) return "MCP returned a JSON-RPC error";
  return typeof value["message"] === "string" ? `MCP JSON-RPC error: ${value["message"]}` : "MCP returned a JSON-RPC error";
}

function integerField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isInteger(field)) throw new Error(`${key} must be an integer`);
  return field;
}

function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function booleanField(value: Record<string, unknown>, key: string): boolean {
  const field = value[key];
  if (typeof field !== "boolean") throw new Error(`${key} must be a boolean`);
  return field;
}

import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { McpHttpError, McpTransportError, WorkbenchMcpClient } from "./mcpClient.js";
import type { AuthorizedResource, WorkbenchAgentAccessState } from "./types.js";
import { WorkbenchClient, WorkbenchHttpError } from "./workbenchClient.js";
import { createWorkbenchToolDefinitions } from "./workbenchTools.js";

describe("Workbench controlled tools", () => {
  it("rejects an unauthorized capability locally and writes a token-free audit event", async () => {
    const state = accessState([capability("allowed.read")]);
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const issueToken = vi.spyOn(workbench, "issueCapabilityToken");
    const logger = { info: vi.fn() };
    const audit = { record: vi.fn() };
    const tool = createWorkbenchToolDefinitions({
      getState: () => state,
      workbench,
      mcp: new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 }),
      invalidate: vi.fn(),
      logger,
      audit,
      auditContext: { userId: "user-1", rootUserId: "root-1", userDisplayName: "测试用户", projectId: "personal-project", sessionId: "pi-session-1", cwd: "/workspace" },
    }).find((definition) => definition.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("call tool was not registered");

    await expect(tool.execute("call-1", { capability_name: "not.allowed", arguments: {} }, undefined, undefined, extensionContext()))
      .rejects.toThrow("未获授权");

    expect(issueToken).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      userDisplayName: "测试用户",
      projectId: "personal-project",
      agentSessionId: "session-1",
      capabilityName: "not.allowed",
      statusCode: "local_error",
    }), "Workbench capability call rejected or failed");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workbench_capability_call",
      status: "failed",
      userId: "user-1",
      rootUserId: "root-1",
      userDisplayName: "测试用户",
      projectId: "personal-project",
      sessionId: "pi-session-1",
      agentSessionId: "session-1",
      capabilityName: "not.allowed",
      statusCode: "local_error",
    }));
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("private-agent-token");
  });

  it("retrieves authorized knowledge with a one-time token and records metadata-only audit", async () => {
    const state = accessState([knowledge("knowledge.nanning.optical", {
      metadata: { provider: "ragflow", ragflow_dataset_id: "dataset-secret" },
    })]);
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const issueToken = vi.spyOn(workbench, "issueKnowledgeToken").mockResolvedValue("private-knowledge-token");
    const retrieve = vi.spyOn(workbench, "retrieveKnowledge").mockResolvedValue({
      total: 1,
      resourceName: "knowledge.nanning.optical",
      resourceVersion: "r3",
      chunks: [{
        id: "chunk-1",
        documentId: "doc-1",
        documentName: "手册.pdf",
        content: "private chunk body",
        similarity: 0.91,
        position: [],
        version: "r3",
        source: "网操中心",
        citation: "knowledge://knowledge.nanning.optical@r3/doc-1/chunk-1",
      }],
    });
    const logger = { info: vi.fn() };
    const audit = { record: vi.fn() };
    const tool = createWorkbenchToolDefinitions({
      getState: () => state,
      workbench,
      mcp: new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 }),
      invalidate: vi.fn(),
      logger,
      audit,
      auditContext: { userId: "user-1", rootUserId: "root-1", userDisplayName: "测试用户", projectId: "personal-project", sessionId: "pi-session-1", cwd: "/workspace" },
    }).find((definition) => definition.name === "workbench_retrieve_knowledge");
    if (tool === undefined) throw new Error("knowledge retrieval tool was not registered");

    const output = await tool.execute("call-1", {
      resource_name: "knowledge.nanning.optical",
      question: "sensitive original query",
      top_k: 7,
      filters: { document_type: "private-filter" },
    }, undefined, undefined, extensionContext());

    expect(issueToken).toHaveBeenCalledTimes(1);
    const tokenCall = issueToken.mock.calls[0];
    if (tokenCall === undefined) throw new Error("knowledge token was not requested");
    expect(tokenCall[0]).toBe("private-agent-token");
    expect(tokenCall[1].resourceName).toBe("knowledge.nanning.optical");
    expect(tokenCall[1].resourceVersion).toBe("r3");
    expect(tokenCall[1].runId).toMatch(/^run-/u);
    expect(tokenCall[1].traceId).toMatch(/^trace-/u);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith("private-knowledge-token", {
      question: "sensitive original query",
      resourceName: "knowledge.nanning.optical",
      topK: 7,
      filters: { document_type: "private-filter" },
    }, undefined);
    expect(JSON.stringify(output)).toContain("knowledge://knowledge.nanning.optical@r3/doc-1/chunk-1");
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
      knowledgeName: "knowledge.nanning.optical",
      knowledgeVersion: "r3",
      resultCount: 1,
    }), "Workbench knowledge retrieval completed");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workbench_knowledge_retrieval",
      status: "completed",
      userId: "user-1",
      rootUserId: "root-1",
      userDisplayName: "测试用户",
      projectId: "personal-project",
      sessionId: "pi-session-1",
      agentSessionId: "session-1",
      authorizationRevision: 12,
      knowledgeName: "knowledge.nanning.optical",
      knowledgeVersion: "r3",
      resultCount: 1,
    }));
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("private-knowledge-token");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("sensitive original query");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("private-filter");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("private chunk body");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("private-knowledge-token");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("sensitive original query");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("private-filter");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("private chunk body");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("dataset-secret");
  });

  it("rejects unauthorized knowledge locally without requesting a token", async () => {
    const state = accessState([knowledge("knowledge.nanning.optical")]);
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const issueToken = vi.spyOn(workbench, "issueKnowledgeToken");
    const audit = { record: vi.fn() };
    const tool = createWorkbenchToolDefinitions({
      getState: () => state,
      workbench,
      mcp: new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 }),
      invalidate: vi.fn(),
      audit,
      auditContext: { userId: "user-1", rootUserId: "root-1", projectId: "personal-project", sessionId: "pi-session-1", cwd: "/workspace" },
    }).find((definition) => definition.name === "workbench_retrieve_knowledge");
    if (tool === undefined) throw new Error("knowledge retrieval tool was not registered");

    await expect(tool.execute("call-1", {
      resource_name: "knowledge.guilin.optical",
      question: "问题",
    }, undefined, undefined, extensionContext())).rejects.toThrow("未获授权");

    expect(issueToken).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workbench_knowledge_retrieval",
      status: "failed",
      knowledgeName: "knowledge.guilin.optical",
      statusCode: "local_error",
    }));
  });

  it("invalidates stale access state and does not retry knowledge retrieval", async () => {
    const state = accessState([knowledge("knowledge.nanning.optical")]);
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const issueToken = vi.spyOn(workbench, "issueKnowledgeToken").mockResolvedValue("private-knowledge-token");
    const retrieve = vi.spyOn(workbench, "retrieveKnowledge").mockRejectedValue(new WorkbenchHttpError(401, "Knowledge token has already been used."));
    const invalidate = vi.fn();
    const tool = createWorkbenchToolDefinitions({
      getState: () => state,
      workbench,
      mcp: new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 }),
      invalidate,
    }).find((definition) => definition.name === "workbench_retrieve_knowledge");
    if (tool === undefined) throw new Error("knowledge retrieval tool was not registered");

    await expect(tool.execute("call-1", {
      resource_name: "knowledge.nanning.optical",
      question: "问题",
    }, undefined, undefined, extensionContext())).rejects.toThrow("重新进入桂小智");

    expect(issueToken).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("rechecks asynchronous authorization after a stale session without replaying an MCP call", async () => {
    const state = accessState([capability("allowed.read")]);
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const issueToken = vi.spyOn(workbench, "issueCapabilityToken")
      .mockRejectedValueOnce(new WorkbenchHttpError(401, "stale authorization"))
      .mockResolvedValueOnce("renewed-capability-token");
    const mcp = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 });
    const call = vi.spyOn(mcp, "callCapability").mockResolvedValue(stableCapabilityResult("allowed.read"));
    const refreshed = { ...state, authorizationRevision: 13, resources: [{ ...capability("allowed.read"), resourceVersion: "3" }] };
    const getState = vi.fn().mockResolvedValueOnce(state).mockResolvedValueOnce(refreshed);
    const tool = createWorkbenchToolDefinitions({ getState, workbench, mcp }).find((definition) => definition.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("call tool was not registered");
    await tool.execute("call-1", { capability_name: "allowed.read", arguments: {} }, undefined, undefined, extensionContext());
    expect(issueToken).toHaveBeenCalledTimes(2);
    expect(getState).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledTimes(1);
    expect(issueToken).toHaveBeenNthCalledWith(2, state.bearerToken, expect.objectContaining({ capabilityVersion: "3" }), expect.any(AbortSignal));
  });

  it("retries one failed MCP handshake with a fresh capability token", async () => {
    const state = accessState([capability("allowed.read")]);
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const issueToken = vi.spyOn(workbench, "issueCapabilityToken")
      .mockResolvedValueOnce("capability-token-1")
      .mockResolvedValueOnce("capability-token-2");
    const mcp = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 });
    const callCapability = vi.spyOn(mcp, "callCapability")
      .mockRejectedValueOnce(new McpTransportError("ECONNRESET", "MCP 通道连接失败（ECONNRESET）", undefined, true))
      .mockResolvedValueOnce(stableCapabilityResult("allowed.read"));
    const logger = { info: vi.fn() };
    const tool = createWorkbenchToolDefinitions({
      getState: () => state,
      workbench,
      mcp,
      invalidate: vi.fn(),
      logger,
    }).find((definition) => definition.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("call tool was not registered");

    const output = await tool.execute("call-1", { capability_name: "allowed.read", arguments: {} }, undefined, undefined, extensionContext());

    expect(issueToken).toHaveBeenCalledTimes(2);
    expect(callCapability).toHaveBeenNthCalledWith(1, "capability-token-1", "allowed.read", {}, undefined, expect.any(AbortSignal));
    expect(callCapability).toHaveBeenNthCalledWith(2, "capability-token-2", "allowed.read", {}, undefined, expect.any(AbortSignal));
    expect(JSON.stringify(output)).toContain('\\"ok\\":true');
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 1 }), "Workbench capability call completed");
  });

  it("logs a safe transport category without replaying an ambiguous failure", async () => {
    const state = accessState([capability("allowed.read")]);
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    vi.spyOn(workbench, "issueCapabilityToken").mockResolvedValue("private-capability-token");
    const mcp = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 });
    vi.spyOn(mcp, "callCapability").mockRejectedValue(new McpTransportError("ENETUNREACH", "MCP 通道连接失败（ENETUNREACH）"));
    const logger = { info: vi.fn() };
    const tool = createWorkbenchToolDefinitions({
      getState: () => state,
      workbench,
      mcp,
      invalidate: vi.fn(),
      logger,
    }).find((definition) => definition.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("call tool was not registered");

    await expect(tool.execute("call-1", { capability_name: "allowed.read", arguments: { query: "private-query" } }, undefined, undefined, extensionContext()))
      .rejects.toThrow("MCP 通道连接失败（ENETUNREACH）");

    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
      capabilityName: "allowed.read",
      statusCode: "mcp_transport_ENETUNREACH",
      errorCode: "ENETUNREACH",
    }), "Workbench capability call rejected or failed");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("private-capability-token");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("private-query");
  });

  it("loads resources once and never replays an ambiguously completed tool request", async () => {
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const token = vi.spyOn(workbench, "issueCapabilityToken").mockResolvedValue("ticket");
    const mcp = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 });
    const call = vi.spyOn(mcp, "callCapability").mockRejectedValue(new McpTransportError("ECONNRESET", "response lost"));
    const getState = vi.fn(() => accessState([capability("allowed.read")]));
    const tool = createWorkbenchToolDefinitions({ getState, workbench, mcp }).find(item => item.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("missing capability tool");
    await expect(tool.execute("call", { capability_name: "allowed.read", arguments: {} }, undefined, undefined, extensionContext())).rejects.toThrow("response lost");
    expect(getState).toHaveBeenCalledTimes(1);
    expect(token).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("never signs a ticket when the caller is already cancelled", async () => {
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const token = vi.spyOn(workbench, "issueCapabilityToken");
    const mcp = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 });
    const getState = vi.fn(() => accessState([capability("allowed.read")]));
    const tool = createWorkbenchToolDefinitions({ getState, workbench, mcp }).find(item => item.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("missing capability tool");
    await expect(tool.execute("call", { capability_name: "allowed.read", arguments: {} }, AbortSignal.abort(new Error("cancelled")), undefined, extensionContext())).rejects.toThrow("cancelled");
    expect(getState).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
  });

  it.each(["busy", "long Retry-After"])("stops %s backoff without signing a second ticket when cancelled", async failure => {
    const controller = new AbortController();
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const token = vi.spyOn(workbench, "issueCapabilityToken").mockResolvedValue("ticket");
    const mcp = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 });
    vi.spyOn(mcp, "callCapability").mockImplementation(() => {
      setTimeout(() => { controller.abort(new Error("cancelled during backoff")); }, 10);
      if (failure === "long Retry-After") return Promise.reject(new McpHttpError(503, "busy", 3_000_000_000, true));
      return Promise.resolve({ ...stableCapabilityResult("allowed.read"), ok: false, status_code: 503,
        error: { code: "native_executor_busy", message: "busy", retryable: true } });
    });
    const tool = createWorkbenchToolDefinitions({ getState: () => accessState([capability("allowed.read")]), workbench, mcp }).find(item => item.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("missing capability tool");
    await expect(tool.execute("call", { capability_name: "allowed.read", arguments: {} }, controller.signal, undefined, extensionContext())).rejects.toThrow();
    expect(token).toHaveBeenCalledTimes(1);
  });
  it("preserves a confirmed result when session cleanup crosses the total deadline", async () => {
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    vi.spyOn(workbench, "issueCapabilityToken").mockResolvedValue("ticket");
    let operation: AbortSignal | null | undefined;
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "test", version: "1.0.0" } } }, { headers: { "mcp-session-id": "session" } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockImplementationOnce((_url, init) => {
        operation = init?.signal;
        return Promise.resolve(Response.json({ result: { content: [{ type: "text", text: JSON.stringify(stableCapabilityResult("allowed.read")) }] } }));
      })
      .mockImplementationOnce(async () => {
        if (operation?.aborted !== true) await new Promise<void>(resolve => { operation?.addEventListener("abort", () => { resolve(); }, { once: true }); });
        return new Response(null, { status: 204 });
      });
    const mcp = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 30, fetch: fetchImpl });
    const tool = createWorkbenchToolDefinitions({ getState: () => accessState([capability("allowed.read")]), workbench, mcp }).find(item => item.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("missing capability tool");
    const output = await tool.execute("call", { capability_name: "allowed.read", arguments: {} }, undefined, undefined, extensionContext());
    expect(operation?.aborted).toBe(true);
    expect(JSON.stringify(output)).toContain('\\"ok\\":true');
    expect(fetchImpl.mock.calls[3]?.[1]?.method).toBe("DELETE");
  });

  it.each(["native_target_busy", "native_client_busy"])("retries %s once without refreshing resources again", async code => {
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const token = vi.spyOn(workbench, "issueCapabilityToken").mockResolvedValue("ticket");
    const mcp = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 });
    const call = vi.spyOn(mcp, "callCapability").mockResolvedValue({ ...stableCapabilityResult("allowed.read"), ok: false, status_code: 503,
      error: { code, message: "busy", retryable: true } });
    const getState = vi.fn(() => accessState([capability("allowed.read")]));
    const tool = createWorkbenchToolDefinitions({ getState, workbench, mcp }).find(item => item.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("missing capability tool");
    await tool.execute("call", { capability_name: "allowed.read", arguments: {} }, undefined, undefined, extensionContext());
    expect(token).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledTimes(2);
    expect(getState).toHaveBeenCalledTimes(1);
  });

  it.each(["blocking_io_busy", "http_execution_timeout", "native_execution_timeout"])("does not replay %s", async code => {
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const token = vi.spyOn(workbench, "issueCapabilityToken").mockResolvedValue("ticket");
    const mcp = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 });
    const call = vi.spyOn(mcp, "callCapability").mockResolvedValue({ ...stableCapabilityResult("allowed.read"), ok: false, status_code: 503,
      error: { code, message: "busy", retryable: true } });
    const tool = createWorkbenchToolDefinitions({ getState: () => accessState([capability("allowed.read")]), workbench, mcp }).find(item => item.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("missing capability tool");
    await tool.execute("call", { capability_name: "allowed.read", arguments: {} }, undefined, undefined, extensionContext());
    expect(token).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After before signing the only retry ticket", async () => {
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 2_000 });
    const issuedAt: number[] = [];
    vi.spyOn(workbench, "issueCapabilityToken").mockImplementation(() => { issuedAt.push(Date.now()); return Promise.resolve("ticket"); });
    const mcp = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 2_000 });
    vi.spyOn(mcp, "callCapability").mockRejectedValueOnce(new McpHttpError(503, "busy", 600, true)).mockResolvedValueOnce(stableCapabilityResult("allowed.read"));
    const getState = vi.fn(() => accessState([capability("allowed.read")]));
    const tool = createWorkbenchToolDefinitions({ getState, workbench, mcp }).find(item => item.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("missing capability tool");
    await tool.execute("call", { capability_name: "allowed.read", arguments: {} }, undefined, undefined, extensionContext());
    expect(issuedAt).toHaveLength(2);
    expect((issuedAt[1] ?? 0) - (issuedAt[0] ?? 0)).toBeGreaterThanOrEqual(590);
    expect(getState).toHaveBeenCalledTimes(1);
  });
});

function extensionContext(): ExtensionToolContext {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the controlled tool does not read extension context.
  return {} as ExtensionToolContext;
}

function accessState(resources: AuthorizedResource[]): WorkbenchAgentAccessState {
  return {
    sessionId: "session-1",
    bearerToken: "private-agent-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
    authorizationRevision: 12,
    resources,
  };
}

function capability(name: string): AuthorizedResource {
  return {
    resourceType: "capability",
    resourceName: name,
    resourceVersion: "2",
    source: "group",
    riskLevel: "L0",
    status: "published",
    displayName: name,
    description: "",
    dependencies: [],
    metadata: {},
  };
}

function knowledge(name: string, patch: Partial<AuthorizedResource> = {}): AuthorizedResource {
  return {
    resourceType: "knowledge",
    resourceName: name,
    resourceVersion: "r3",
    source: "group",
    riskLevel: "L0",
    status: "published",
    displayName: name,
    description: "",
    dependencies: [],
    metadata: {},
    ...patch,
  };
}

function stableCapabilityResult(name: string) {
  return {
    ok: true,
    capability_name: name,
    status_code: 200,
    data: { value: "ok" },
    error: null,
    meta: { trace_id: "mcp-trace", duration_ms: 12, truncated: false },
  };
}

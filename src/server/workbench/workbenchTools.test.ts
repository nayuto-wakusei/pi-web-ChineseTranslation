import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { McpTransportError, WorkbenchMcpClient } from "./mcpClient.js";
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
    });
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

  it("retries one MCP transport failure with a fresh capability token", async () => {
    const state = accessState([capability("allowed.read")]);
    const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
    const issueToken = vi.spyOn(workbench, "issueCapabilityToken")
      .mockResolvedValueOnce("capability-token-1")
      .mockResolvedValueOnce("capability-token-2");
    const mcp = new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 });
    const callCapability = vi.spyOn(mcp, "callCapability")
      .mockRejectedValueOnce(new McpTransportError("ECONNRESET", "MCP 通道连接失败（ECONNRESET）"))
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
    expect(callCapability).toHaveBeenNthCalledWith(1, "capability-token-1", "allowed.read", {}, undefined);
    expect(callCapability).toHaveBeenNthCalledWith(2, "capability-token-2", "allowed.read", {}, undefined);
    expect(JSON.stringify(output)).toContain('\\"ok\\":true');
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 1 }), "Workbench capability call completed");
  });

  it("logs a safe transport category after the retry is exhausted", async () => {
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
});

function extensionContext(): ExtensionContext {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the controlled tool does not read extension context.
  return {} as ExtensionContext;
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

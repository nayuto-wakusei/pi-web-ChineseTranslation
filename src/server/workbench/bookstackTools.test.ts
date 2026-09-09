import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createManagementPermissionSystemPolicy, managementAgentToolNames } from "../sessions/managementPermissionSystem.js";
import { WorkbenchMcpClient } from "./mcpClient.js";
import type { AuthorizedResource, BookstackRetrievalResult, WorkbenchAgentAccessState } from "./types.js";
import { record, WorkbenchClient, WorkbenchHttpError } from "./workbenchClient.js";
import { createWorkbenchToolDefinitions } from "./workbenchTools.js";

describe("BookStack controlled tool", () => {
  it("retrieves only the authorized book through a one-time token and audits metadata only", async () => {
    const h = harness();
    const output = await h.tool.execute("call-1", { resource_name: "bookstack.gx.1", question: " private question ", top_k: 7 }, undefined, undefined, context());
    expect(h.issueToken).toHaveBeenCalledExactlyOnceWith("private-agent-token", expect.objectContaining({
      resourceName: "bookstack.gx.1", resourceVersion: "live",
    }));
    expect(h.issueToken.mock.calls[0]?.[1].runId).toMatch(/^run-/u);
    expect(h.issueToken.mock.calls[0]?.[1].traceId).toMatch(/^trace-/u);
    expect(h.retrieve).toHaveBeenCalledExactlyOnceWith("private-knowledge-token", { resourceName: "bookstack.gx.1", question: "private question", topK: 7 });
    expect(JSON.stringify(output)).toContain("knowledge://bookstack.gx.1@live/12/2");
    expect(h.ragflow).not.toHaveBeenCalled();
    expect(h.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "workbench_knowledge_retrieval", status: "completed", knowledgeName: "bookstack.gx.1", knowledgeVersion: "live", resultCount: 1 }));
    expect(JSON.stringify([h.logger.info.mock.calls, h.audit.record.mock.calls])).not.toMatch(/private-(agent|knowledge)-token|private question|private body|private-book-id/u);
  });

  it.each([
    { name: "ungranted", input: "bookstack.gx.2", patch: {} },
    { name: "RAGFlow", input: "bookstack.gx.1", patch: { metadata: { provider: "ragflow" } } },
    { name: "draft", input: "bookstack.gx.1", patch: { status: "draft" } },
    { name: "disabled", input: "bookstack.gx.1", patch: { status: "disabled" } },
    { name: "write risk", input: "bookstack.gx.1", patch: { riskLevel: "L1" } },
    { name: "unknown provider", input: "bookstack.gx.1", patch: { metadata: { provider: "other" } } },
  ])("rejects $name before requesting a token", async ({ input, patch }) => {
    const h = harness(patch);
    await expect(h.tool.execute("call-1", { resource_name: input, question: "question" }, undefined, undefined, context())).rejects.toThrow("未获授权");
    expect(h.issueToken).not.toHaveBeenCalled();
    expect(h.retrieve).not.toHaveBeenCalled();
    expect(h.audit.record).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("rejects blank questions and stale resource versions locally", async () => {
    const h = harness();
    await expect(h.tool.execute("call-1", { resource_name: "bookstack.gx.1", question: " " }, undefined, undefined, context())).rejects.toThrow("不能为空");
    await expect(h.tool.execute("call-1", { resource_name: "bookstack.gx.1", question: "question", resource_version: "r3" }, undefined, undefined, context())).rejects.toThrow("版本不在当前授权快照");
    expect(h.issueToken).not.toHaveBeenCalled();
  });

  it("refreshes authorization once before token issuance without replaying retrieval", async () => {
    const h = harness();
    h.issueToken.mockRejectedValueOnce(new WorkbenchHttpError(401, "stale"));
    await h.tool.execute("call-1", { resource_name: "bookstack.gx.1", question: "question" }, undefined, undefined, context());
    expect(h.getState).toHaveBeenCalledTimes(2);
    expect(h.issueToken).toHaveBeenCalledTimes(2);
    expect(h.retrieve).toHaveBeenCalledTimes(1);
  });

  it("does not use a removed grant after authorization refresh", async () => {
    const h = harness();
    h.issueToken.mockRejectedValueOnce(new WorkbenchHttpError(401, "stale"));
    h.getState.mockResolvedValueOnce(h.state).mockResolvedValueOnce({ ...h.state, resources: [] });
    await expect(h.tool.execute("call-1", { resource_name: "bookstack.gx.1", question: "question" }, undefined, undefined, context())).rejects.toThrow("未获授权");
    expect(h.issueToken).toHaveBeenCalledTimes(1);
    expect(h.retrieve).not.toHaveBeenCalled();
  });

  it.each([401, 403])("fails closed on content HTTP %s without replaying a consumed token", async (status) => {
    const h = harness();
    h.retrieve.mockRejectedValueOnce(new WorkbenchHttpError(status, "rejected"));
    await expect(h.tool.execute("call-1", { resource_name: "bookstack.gx.1", question: "question" }, undefined, undefined, context())).rejects.toThrow("重新进入桂小智");
    expect(h.issueToken).toHaveBeenCalledTimes(1);
    expect(h.retrieve).toHaveBeenCalledTimes(1);
    expect(h.invalidate).toHaveBeenCalledTimes(1);
  });

  it("exposes bounded parameters and the actual definition to management policy while respecting explicit denies", () => {
    const h = harness();
    expect(h.tool.parameters).toMatchObject({ additionalProperties: false, properties: { top_k: { minimum: 1, maximum: 20 } } });
    const properties = record(record(h.tool.parameters, "tool parameters")["properties"], "tool properties");
    expect(Object.keys(properties).sort()).toEqual(["question", "resource_name", "resource_version", "top_k"]);
    const toolNames = h.tools.map((tool) => tool.name);
    const management = { user: { id: "u", rootUserId: "u", roles: [], permissions: ["tools:execute"] }, projects: [{ id: "p", name: "Project" }] };
    expect(managementAgentToolNames(management, toolNames)).toContain("workbench_retrieve_bookstack");
    expect(createManagementPermissionSystemPolicy(management, toolNames).tools).toMatchObject({ workbench_retrieve_bookstack: "allow", bash: "deny", http: "deny", mcp: "deny" });
    const denied = { ...management, tools: { deny: ["workbench_retrieve_bookstack"] } };
    expect(managementAgentToolNames(denied, toolNames)).not.toContain("workbench_retrieve_bookstack");
    expect(createManagementPermissionSystemPolicy(denied, toolNames).tools).toMatchObject({ workbench_retrieve_bookstack: "deny" });
    expect(managementAgentToolNames(management)).not.toContain("workbench_retrieve_bookstack");
  });
});

function harness(patch: Partial<AuthorizedResource> = {}) {
  const state: WorkbenchAgentAccessState = {
    sessionId: "agent-session", bearerToken: "private-agent-token", expiresAt: "2099-01-01T00:00:00.000Z", authorizationRevision: 12,
    resources: [{ resourceType: "knowledge", resourceName: "bookstack.gx.1", resourceVersion: "live", source: "group", riskLevel: "L0", status: "published", displayName: "Book", description: "", dependencies: [], metadata: { provider: "bookstack", bookId: "private-book-id" }, ...patch }],
  };
  const result: BookstackRetrievalResult = {
    resourceName: "bookstack.gx.1", resourceVersion: "live", truncated: false,
    pages: [{ pageId: "12", title: "Page", content: "private body", updatedAt: "2026-09-09T00:00:00Z", revision: 2, url: "https://workbench/bookstack/link/12", citation: "knowledge://bookstack.gx.1@live/12/2" }],
  };
  const workbench = new WorkbenchClient({ baseUrl: "http://workbench", requestTimeoutMs: 1_000 });
  const issueToken = vi.spyOn(workbench, "issueKnowledgeToken").mockResolvedValue("private-knowledge-token");
  const retrieve = vi.spyOn(workbench, "retrieveBookstack").mockResolvedValue(result);
  const ragflow = vi.spyOn(workbench, "retrieveKnowledge");
  const getState = vi.fn(() => Promise.resolve(state));
  const invalidate = vi.fn();
  const logger = { info: vi.fn() };
  const audit = { record: vi.fn() };
  const tools = createWorkbenchToolDefinitions({ getState, workbench, mcp: new WorkbenchMcpClient({ mcpUrl: "http://mcp/mcp", timeoutMs: 1_000 }), invalidate, logger, audit, auditContext: { userId: "u", rootUserId: "u", projectId: "p", sessionId: "pi-session", cwd: "/workspace" } });
  const tool = tools.find((item) => item.name === "workbench_retrieve_bookstack");
  if (tool === undefined) throw new Error("BookStack tool not registered");
  return { state, getState, tools, tool, issueToken, retrieve, ragflow, invalidate, logger, audit };
}

function context(): ExtensionContext {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the controlled tool does not read extension context.
  return {} as ExtensionContext;
}

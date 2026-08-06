import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchMcpClient } from "./mcpClient.js";
import type { AuthorizedResource, WorkbenchAgentAccessState } from "./types.js";
import { WorkbenchClient } from "./workbenchClient.js";
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
      auditContext: { userId: "user-1", rootUserId: "root-1", projectId: "personal-project", sessionId: "pi-session-1", cwd: "/workspace" },
    }).find((definition) => definition.name === "icnoc_call_capability");
    if (tool === undefined) throw new Error("call tool was not registered");

    await expect(tool.execute("call-1", { capability_name: "not.allowed", arguments: {} }, undefined, undefined, extensionContext()))
      .rejects.toThrow("未获授权");

    expect(issueToken).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
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
      projectId: "personal-project",
      sessionId: "pi-session-1",
      agentSessionId: "session-1",
      capabilityName: "not.allowed",
      statusCode: "local_error",
    }));
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("private-agent-token");
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

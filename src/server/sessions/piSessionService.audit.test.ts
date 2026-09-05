import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testManagementContext } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

describe("PiSessionService audit boundaries", () => {
  it("audits ordinary-mode tool execution without arguments or results", async () => {
    let listener: ((event: unknown) => void) | undefined;
    const fake = fakeRuntime("audit-session", {
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    const logger = { info: vi.fn() };
    const normalToolAudit = { record: vi.fn() };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("audit-session")]),
      heartbeatIntervalMs: 60_000,
      logger,
      normalToolAudit,
    });

    await service.status(sessionRef("audit-session"));
    listener?.({ type: "tool_execution_start", toolName: "read", toolCallId: "call-1", args: { token: "secret" } });
    listener?.({ type: "tool_execution_end", toolName: "read", toolCallId: "call-1", isError: false, result: "private result" });

    expect(logger.info).toHaveBeenNthCalledWith(1, {
      mode: "normal",
      sessionId: "audit-session",
      cwd: "/workspace",
      toolName: "read",
      toolCallId: "call-1",
      status: "started",
    }, "Pi tool execution audit");
    expect(logger.info).toHaveBeenNthCalledWith(2, expect.objectContaining({ mode: "normal", status: "completed" }), "Pi tool execution audit");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("private result");
    expect(normalToolAudit.record).toHaveBeenCalledTimes(2);
    expect(normalToolAudit.record).toHaveBeenLastCalledWith({
      sessionId: "audit-session",
      cwd: "/workspace",
      toolName: "read",
      toolCallId: "call-1",
      status: "completed",
    });

    await service.dispose();
  });

  it("writes management-mode tool arguments and results only to Elasticsearch audit", async () => {
    let listener: ((event: unknown) => void) | undefined;
    const fake = fakeRuntime("managed-audit-session", {
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    const logger = { info: vi.fn() };
    const normalToolAudit = { record: vi.fn() };
    const managementAudit = { record: vi.fn() };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("managed-audit-session")]),
      heartbeatIntervalMs: 60_000,
      logger,
      normalToolAudit,
      managementAudit,
      managementProjectIdForCwd: vi.fn().mockResolvedValue("matched-project"),
    });

    const managementContext = testManagementContext();
    managementContext.user.displayName = "测试用户";
    await service.status(sessionRef("managed-audit-session"), managementContext);
    listener?.({ type: "tool_execution_start", toolName: "read", toolCallId: "call-1", args: { path: "/workspace/file.txt" } });
    listener?.({ type: "tool_execution_end", toolName: "read", toolCallId: "call-1", isError: false, result: { content: [{ type: "text", text: "file body" }] } });

    expect(normalToolAudit.record).not.toHaveBeenCalled();
    expect(managementAudit.record).toHaveBeenNthCalledWith(1, {
      action: "tool_execution",
      status: "started",
      userId: "account-1",
      rootUserId: "root-user",
      userDisplayName: "测试用户",
      projectId: "matched-project",
      sessionId: "managed-audit-session",
      cwd: "/workspace",
      toolName: "read",
      toolCallId: "call-1",
      content: { path: "/workspace/file.txt" },
    });
    expect(managementAudit.record).toHaveBeenNthCalledWith(2, {
      action: "tool_execution",
      status: "completed",
      userId: "account-1",
      rootUserId: "root-user",
      userDisplayName: "测试用户",
      projectId: "matched-project",
      sessionId: "managed-audit-session",
      cwd: "/workspace",
      toolName: "read",
      toolCallId: "call-1",
      content: { content: [{ type: "text", text: "file body" }] },
    });
    await service.prompt(
      sessionRef("managed-audit-session"),
      "用户的完整问题",
      undefined,
      undefined,
      { managementContext },
    );
    listener?.({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private reasoning" },
          { type: "text", text: "模型的完整回复" },
        ],
      },
    });
    expect(managementAudit.record).toHaveBeenNthCalledWith(3, {
      action: "user_prompt",
      status: "completed",
      userId: "account-1",
      rootUserId: "root-user",
      userDisplayName: "测试用户",
      projectId: "matched-project",
      sessionId: "managed-audit-session",
      cwd: "/workspace",
      content: "用户的完整问题",
    });
    expect(managementAudit.record).toHaveBeenNthCalledWith(4, {
      action: "assistant_response",
      status: "completed",
      userId: "account-1",
      rootUserId: "root-user",
      userDisplayName: "测试用户",
      projectId: "matched-project",
      sessionId: "managed-audit-session",
      cwd: "/workspace",
      content: {
        role: "assistant",
        content: [{ type: "text", text: "模型的完整回复" }],
      },
    });
    expect(JSON.stringify(managementAudit.record.mock.calls)).not.toContain("private reasoning");
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ mode: "management", userId: "account-1", userDisplayName: "测试用户", projectId: "matched-project" }), "Pi tool execution audit");

    await service.dispose();
  });

  it("keeps ordinary tool execution running when SQLite audit persistence fails", async () => {
    let listener: ((event: unknown) => void) | undefined;
    const fake = fakeRuntime("audit-failure-session", {
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    const logger = { info: vi.fn() };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("audit-failure-session")]),
      heartbeatIntervalMs: 60_000,
      logger,
      normalToolAudit: { record() { throw new Error("database unavailable"); } },
    });

    await service.status(sessionRef("audit-failure-session"));
    expect(() => { listener?.({ type: "tool_execution_start", toolName: "read", toolCallId: "call-1" }); }).not.toThrow();
    expect(logger.info).toHaveBeenCalledWith({
      sessionId: "audit-failure-session",
      toolCallId: "call-1",
      error: "database unavailable",
    }, "failed to persist ordinary-mode tool audit");
    await service.dispose();
  });
});

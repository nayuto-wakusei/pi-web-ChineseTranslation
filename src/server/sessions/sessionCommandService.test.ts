import { describe, expect, it, vi } from "vitest";
import type { SessionUiEvent } from "../../shared/apiTypes.js";
import { SessionCommandService, type CommandActiveSession, type CommandSession } from "./sessionCommandService.js";

interface TestCommandSession extends CommandSession {
  sessionName: string | undefined;
}

function activeSession(overrides: Partial<TestCommandSession> = {}): CommandActiveSession<TestCommandSession> {
  const session: TestCommandSession = {
    sessionId: "s1",
    sessionFile: "/tmp/s1.jsonl",
    sessionName: undefined,
    messages: [{}, {}],
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    pendingMessageCount: 0,
    promptTemplates: [{ name: "template" }],
    extensionRunner: { getRegisteredCommands: () => [{ invocationName: "ext" }] },
    resourceLoader: { getSkills: () => ({ skills: [{ name: "skill-a" }] }) },
    sessionManager: { getLeafId: () => "leaf-1" },
    setSessionName: vi.fn((name: string) => { session.sessionName = name; }),
    compact: vi.fn(async () => {
      await Promise.resolve();
      return { summary: "short summary", tokensBefore: 123 };
    }),
    getSessionStats: vi.fn(() => ({
      sessionId: "s1",
      totalMessages: 2,
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 3,
      tokens: { input: 10, output: 5, total: 15 },
      cost: 0.12345,
    })),
    getUserMessagesForForking: vi.fn(() => [{ entryId: "m1", text: "hello ".repeat(40) }]),
    ...overrides,
  };
  return { runtime: { cwd: "/work", session, fork: vi.fn(() => Promise.resolve({ cancelled: false })) } };
}

async function getActive(active: CommandActiveSession<TestCommandSession>): Promise<CommandActiveSession> {
  await Promise.resolve();
  return active;
}

async function promptAccepted(): Promise<void> {
  await Promise.resolve();
}

function eventPublisher() {
  return { publish: vi.fn<(sessionId: string, event: SessionUiEvent, eventScope?: string) => void>() };
}

describe("SessionCommandService", () => {
  it("rejects unknown commands and forwards runtime commands as prompts", async () => {
    const active = activeSession();
    const prompt = vi.fn(promptAccepted);
    const service = new SessionCommandService(() => getActive(active), prompt, eventPublisher());

    await expect(service.run("s1", "/missing")).resolves.toEqual({ type: "unsupported", message: "未知命令：/missing" });
    // Forwarded runtime commands return a bare done result: the agent streams
    // back the canonical expanded message, so no synthetic "Accepted" line.
    await expect(service.run("s1", "/ext arg")).resolves.toEqual({ type: "done" });
    await expect(service.run("s1", "/template arg")).resolves.toMatchObject({ type: "done" });
    await expect(service.run("s1", "/skill:skill-a arg")).resolves.toMatchObject({ type: "done" });
    expect(prompt).toHaveBeenCalledTimes(3);
    expect(prompt).toHaveBeenNthCalledWith(1, "s1", "/ext arg", undefined);
    expect(prompt).toHaveBeenNthCalledWith(2, "s1", "/template arg", undefined);
    expect(prompt).toHaveBeenNthCalledWith(3, "s1", "/skill:skill-a arg", undefined);
  });

  it("uses the supplied event scope for runtime command prompts and events", async () => {
    const active = activeSession();
    const getScopedActive = vi.fn((sessionId: string, eventScope?: string) => {
      expect(sessionId).toBe("s1");
      expect(eventScope).toBe("management:account-1");
      return getActive(active);
    });
    const prompt = vi.fn(promptAccepted);
    const events = eventPublisher();
    const service = new SessionCommandService(getScopedActive, prompt, events);

    await expect(service.run("s1", "/ext arg", "management:account-1")).resolves.toEqual({ type: "done" });
    await expect(service.run("s1", "/name Scoped name", "management:account-1")).resolves.toMatchObject({ type: "done" });

    expect(prompt).toHaveBeenCalledWith("s1", "/ext arg", "management:account-1");
    expect(events.publish).toHaveBeenCalledWith("s1", { type: "session.name", sessionId: "s1", name: "Scoped name" }, "management:account-1");
  });

  it("renames sessions, publishes the name update, and returns updated client session metadata", async () => {
    const active = activeSession();
    const events = eventPublisher();
    const service = new SessionCommandService(() => getActive(active), vi.fn(), events);

    await expect(service.run("s1", "/name Useful name")).resolves.toMatchObject({
      type: "done",
      message: "会话已命名：Useful name",
      session: { id: "s1", cwd: "/work", name: "Useful name", messageCount: 2 },
    });
    expect(active.runtime.session.setSessionName).toHaveBeenCalledWith("Useful name");
    expect(events.publish).toHaveBeenCalledWith("s1", { type: "session.name", sessionId: "s1", name: "Useful name" }, undefined);
  });

  it("formats session stats", async () => {
    const active = activeSession();
    const service = new SessionCommandService(() => getActive(active), vi.fn(), eventPublisher());

    await expect(service.run("s1", "/session")).resolves.toEqual({
      type: "done",
      message: "会话：s1\n消息：2（用户 1，助手 1）\n工具调用：3\nTokens：↑10 ↓5 总计 15\n费用：$0.1235",
    });
  });

  it("starts compaction, updates lifecycle hooks, and publishes completion", async () => {
    const active = activeSession();
    const events = eventPublisher();
    const onCompactionStart = vi.fn();
    const onCompactionEnd = vi.fn();
    const service = new SessionCommandService(() => getActive(active), vi.fn(), events, { onCompactionStart, onCompactionEnd });

    await expect(service.run("s1", "/compact focus on tests")).resolves.toEqual({ type: "done", message: "已开始压缩…" });
    expect(onCompactionStart).toHaveBeenCalledWith(active.runtime.session);
    await vi.waitFor(() => {
      expect(events.publish).toHaveBeenCalledWith("s1", {
        type: "command.output",
        level: "success",
        message: "压缩完成。\n压缩前 tokens：123\n\nshort summary",
      }, undefined);
      expect(onCompactionEnd).toHaveBeenCalledWith(active.runtime.session, "success");
    });
    expect(active.runtime.session.compact).toHaveBeenCalledWith("focus on tests");
  });

  it("reloads runtime resources through the injected lifecycle callback", async () => {
    const active = activeSession();
    const reloadSession = vi.fn(async () => { await Promise.resolve(); });
    const service = new SessionCommandService(() => getActive(active), vi.fn(), eventPublisher(), { reloadSession });

    await expect(service.run("s1", "/reload")).resolves.toEqual({
      type: "done",
      message: "会话运行时资源已重新加载。扩展、技能、提示词模板、主题以及上下文/系统提示词文件已刷新；PI WEB 浏览器插件变更仍需另行刷新浏览器页面。",
    });
    expect(reloadSession).toHaveBeenCalledWith(active.runtime.session);
  });

  it("rejects runtime reload while the session has active work", async () => {
    const active = activeSession({ isBashRunning: true });
    const reloadSession = vi.fn(async () => { await Promise.resolve(); });
    const service = new SessionCommandService(() => getActive(active), vi.fn(), eventPublisher(), { reloadSession });

    await expect(service.run("s1", "/reload")).resolves.toEqual({
      type: "unsupported",
      message: "会话活动期间无法重新加载，请先停止当前活动。",
    });
    expect(reloadSession).not.toHaveBeenCalled();
  });

  it("creates fork selection requests from newest message to oldest and responds with selected entry", async () => {
    const active = activeSession({
      getUserMessagesForForking: vi.fn(() => [
        { entryId: "oldest", text: "oldest message" },
        { entryId: "middle", text: "middle message" },
        { entryId: "newest", text: "newest message" },
      ]),
    });
    vi.mocked(active.runtime.fork).mockResolvedValueOnce({ cancelled: false, selectedText: "newest message" });
    const service = new SessionCommandService(() => getActive(active), vi.fn(), eventPublisher());

    const result = await service.run("s1", "/fork");

    expect(result).toMatchObject({ type: "select", title: "从消息分叉", options: [{ value: "newest" }, { value: "middle" }, { value: "oldest" }] });
    if (result.type !== "select") throw new Error("Expected select result");
    await expect(service.respond("s1", result.requestId, "newest")).resolves.toMatchObject({ type: "done", message: "会话已分叉", session: { id: "s1" }, promptDraft: "newest message" });
    expect(active.runtime.fork).toHaveBeenCalledWith("newest");
    await expect(service.respond("s1", result.requestId, "newest")).resolves.toEqual({ type: "unsupported", message: "命令请求已过期" });
  });

  it("keeps fork selection responses scoped to the request that created them", async () => {
    const active = activeSession();
    const service = new SessionCommandService(() => getActive(active), vi.fn(), eventPublisher());

    const result = await service.run("s1", "/fork", "management:account-1");
    if (result.type !== "select") throw new Error("Expected select result");

    await expect(service.respond("s1", result.requestId, "m1")).resolves.toEqual({ type: "unsupported", message: "命令请求已过期" });
    await expect(service.respond("s1", result.requestId, "m1", "management:account-1")).resolves.toMatchObject({ type: "done", message: "会话已分叉" });
  });

  it("names forked sessions from the source title with the next available counter", async () => {
    const active = activeSession({ sessionName: "Build auth" });
    const forked = activeSession({ sessionId: "forked", sessionName: undefined }).runtime.session;
    vi.mocked(active.runtime.fork).mockImplementationOnce(() => {
      active.runtime.session = forked;
      return Promise.resolve({ cancelled: false, selectedText: "newest message" });
    });
    const events = eventPublisher();
    const service = new SessionCommandService(() => getActive(active), vi.fn(), events, {}, {
      listSessionNames: () => Promise.resolve(["Build auth", "Build auth — 分叉 1"]),
    });

    const result = await service.run("s1", "/fork");
    if (result.type !== "select") throw new Error("Expected select result");
    await expect(service.respond("s1", result.requestId, "newest")).resolves.toMatchObject({
      type: "done",
      message: "会话已分叉",
      session: { id: "forked", name: "Build auth — 分叉 2" },
    });
    expect(forked.setSessionName).toHaveBeenCalledWith("Build auth — 分叉 2");
    expect(events.publish).toHaveBeenCalledWith("forked", { type: "session.name", sessionId: "forked", name: "Build auth — 分叉 2" }, undefined);
  });

  it("names cloned sessions as copies of the source title", async () => {
    const active = activeSession({ sessionName: "Build auth — 分叉 1" });
    const cloned = activeSession({ sessionId: "copy", sessionName: undefined }).runtime.session;
    vi.mocked(active.runtime.fork).mockImplementationOnce(() => {
      active.runtime.session = cloned;
      return Promise.resolve({ cancelled: false });
    });
    const service = new SessionCommandService(() => getActive(active), vi.fn(), eventPublisher(), {}, {
      listSessionNames: () => Promise.resolve(["Build auth", "Build auth — 副本 1"]),
    });

    await expect(service.run("s1", "/clone")).resolves.toMatchObject({
      type: "done",
      message: "会话已克隆",
      session: { id: "copy", name: "Build auth — 副本 2" },
    });
    expect(active.runtime.fork).toHaveBeenCalledWith("leaf-1", { position: "at" });
    expect(cloned.setSessionName).toHaveBeenCalledWith("Build auth — 副本 2");
  });

  it("rejects fork and clone while the session has active work", async () => {
    const active = activeSession({ isStreaming: true });
    const service = new SessionCommandService(() => getActive(active), vi.fn(), eventPublisher());

    await expect(service.run("s1", "/fork")).resolves.toEqual({
      type: "unsupported",
      message: "会话活动期间无法分叉。请先停止当前活动。",
    });
    await expect(service.run("s1", "/clone")).resolves.toEqual({
      type: "unsupported",
      message: "会话活动期间无法克隆。请先停止当前活动。",
    });
    expect(active.runtime.fork).not.toHaveBeenCalled();
  });

  it("rejects fork responses if the session becomes active after choosing fork", async () => {
    const active = activeSession();
    const service = new SessionCommandService(() => getActive(active), vi.fn(), eventPublisher());

    const result = await service.run("s1", "/fork");
    if (result.type !== "select") throw new Error("Expected select result");
    active.runtime.session.isStreaming = true;

    await expect(service.respond("s1", result.requestId, "m1")).resolves.toEqual({
      type: "unsupported",
      message: "会话活动期间无法分叉。请先停止当前活动。",
    });
    expect(active.runtime.fork).not.toHaveBeenCalled();
  });
});

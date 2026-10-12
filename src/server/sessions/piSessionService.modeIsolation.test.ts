import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachWorkbenchAccessHandle, workbenchAccessHandle } from "../managementEmbed.js";
import { eventScopeFromManagementContext, NORMAL_SESSION_EVENT_SCOPE } from "../realtime/sessionEventScope.js";
import { PiSessionService, type PiAgentSession } from "./piSessionService.js";
import { fakeRuntime, fakeSessionManager, ScopeCapturingSessionEventHub, sessionGateway, sessionRecord, sessionRef, testManagementContext, testModelRuntime, type RuntimeCreator } from "./piSessionService.testSupport.js";

const id = "shared-session";
const questions = [{ id: "choice", question: "Choose", options: [] }];

async function modeService() {
  const normal = fakeRuntime(id);
  const managed = fakeRuntime(id);
  const context = testManagementContext();
  const events = new ScopeCapturingSessionEventHub();
  const service = new PiSessionService(events, {
    modelRuntime: testModelRuntime,
    managementModelRuntime: testModelRuntime,
    sessionManager: sessionGateway([sessionRecord(id)]),
    createAgentRuntime: (_factory, options) => Promise.resolve(options.managementContext === undefined ? normal.runtime : managed.runtime),
    askUserEnabled: true,
    heartbeatIntervalMs: 60_000,
  });
  await service.status(sessionRef(id));
  await service.status(sessionRef(id), context);
  return { service, normal, managed, context, events };
}

async function trackedModeService() {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-tracked-modes-"));
  const parentId = "same-parent";
  const childId = "same-child";
  const context = attachWorkbenchAccessHandle(testManagementContext(), "test-access-handle");
  async function mode(name: string) {
    const parentFile = join(directory, `${name}-parent.jsonl`);
    const childFile = join(directory, `${name}-child.jsonl`);
    await writeFile(parentFile, `${JSON.stringify({ type: "session", version: 3, id: parentId, cwd: "/workspace" })}\n`);
    await writeFile(childFile, `${JSON.stringify({ type: "session", version: 3, id: childId, cwd: "/workspace", parentSession: parentFile })}\n`);
    const parentAppend = vi.fn();
    const childAppend = vi.fn();
    const parentManager = fakeSessionManager("/workspace", {
      getSessionId: () => parentId,
      getSessionFile: () => parentFile,
      getEntries: () => [{ type: "custom", customType: "pi-web.subsession.link", data: {
        version: 1, spawnedBySessionId: parentId, spawnedSessionId: childId, spawnedSessionFile: childFile, cwd: "/workspace",
        managementContext: context,
      } }],
      appendCustomEntry: parentAppend,
    });
    const childManager = fakeSessionManager("/workspace", {
      getSessionId: () => childId,
      getSessionFile: () => childFile,
      getHeader: () => ({ parentSession: parentFile }),
      getEntries: () => [{ type: "custom", customType: "pi-web.subsession.spawned", data: { version: 1, spawnedBySessionId: parentId, spawnedSessionId: childId } }],
      getBranch: () => [{ type: "message", message: { role: "assistant", content: `${name} result` } }],
      appendCustomEntry: childAppend,
    });
    return {
      parentFile, childFile, parentManager, childManager, parentAppend, childAppend,
      parent: fakeRuntime(parentId, { sessionFile: parentFile, sessionManager: parentManager }),
      child: fakeRuntime(childId, { sessionFile: childFile, sessionManager: childManager }),
    };
  }
  const normal = await mode("ordinary");
  const managed = await mode("managed");
  const creates: Parameters<RuntimeCreator>[1][] = [];
  const service = new PiSessionService(new ScopeCapturingSessionEventHub(), {
    modelRuntime: testModelRuntime, managementModelRuntime: testModelRuntime,
    sessionManager: {
      ...sessionGateway([{ ...sessionRecord(parentId), path: normal.parentFile }]),
      create: () => normal.childManager,
      open: (file) => {
        for (const runtime of [normal, managed]) {
          if (file === runtime.parentFile) return runtime.parentManager;
          if (file === runtime.childFile) return runtime.childManager;
        }
        throw new Error(`Unexpected session file ${file}`);
      },
    },
    createAgentRuntime: (_factory, options) => {
      creates.push(options);
      const owner = options.managementContext === undefined ? normal : managed;
      return Promise.resolve(options.sessionManager.getSessionId() === childId ? owner.child.runtime : owner.parent.runtime);
    },
    spawnTargets: { resolveSpawnTarget: () => Promise.resolve({ allowed: true, cwd: "/workspace" }) },
    heartbeatIntervalMs: 60_000,
  });
  return { service, normal, managed, context, creates, parentId, childId, async dispose() {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  } };
}

afterEach(() => { vi.useRealTimers(); });

describe("session mode ownership", () => {
  it("keeps asks and their events separate for the same normal and management session id", async () => {
    const { service, normal, managed, context, events } = await modeService();
    try {
      const ordinary = await service.openAsk({ sessionId: id, questions });
      const management = await service.openAsk({ sessionId: id, questions }, context);
      expect(management.superseded).toBeUndefined();
      expect((await service.status(sessionRef(id))).pendingAsk?.askId).toBe(ordinary.ask.askId);
      expect((await service.status(sessionRef(id), context)).pendingAsk?.askId).toBe(management.ask.askId);
      expect(await service.submitAsk(sessionRef(id), management.ask.askId, { answers: [] })).toMatchObject({ result: "stale" });
      await service.submitAsk(sessionRef(id), management.ask.askId, { answers: [] }, context);
      expect(normal.calls.sendCustomMessage).toHaveLength(0);
      expect(managed.calls.sendCustomMessage).toHaveLength(1);
      expect((await service.status(sessionRef(id))).pendingAsk?.askId).toBe(ordinary.ask.askId);
      expect(events.sessionEvents.filter(({ event }) => event.type === "ask.opened" || event.type === "ask.closed").map(({ scope }) => scope))
        .toEqual([NORMAL_SESSION_EVENT_SCOPE, eventScopeFromManagementContext(context), eventScopeFromManagementContext(context)]);
    } finally { await service.dispose(); }
  });

  it("does not clear the other mode's open ask when stopping a runtime", async () => {
    const { service, context } = await modeService();
    try {
      const ordinary = await service.openAsk({ sessionId: id, questions });
      await service.openAsk({ sessionId: id, questions }, context);
      await service.stop(sessionRef(id), context);
      expect((await service.status(sessionRef(id))).pendingAsk?.askId).toBe(ordinary.ask.askId);
    } finally { await service.dispose(); }
  });

  it("drains compaction prompts only into the originating runtime and preserves the other mode on clear", async () => {
    vi.useFakeTimers();
    const { service, normal, managed, context } = await modeService();
    try {
      normal.session.isCompacting = true;
      managed.session.isCompacting = true;
      await service.prompt(sessionRef(id), "ordinary queued", "followUp");
      await service.prompt(sessionRef(id), "managed queued", "followUp", undefined, { managementContext: context });
      expect((await service.status(sessionRef(id))).queuedMessages.map(({ text }) => text)).toEqual(["ordinary queued"]);
      expect((await service.status(sessionRef(id), context)).queuedMessages.map(({ text }) => text)).toEqual(["managed queued"]);
      await service.clearQueue(sessionRef(id));
      managed.session.isCompacting = false;
      managed.emit({ type: "compaction_end" });
      await vi.advanceTimersByTimeAsync(1);
      expect(normal.calls.prompt).toHaveLength(0);
      expect(managed.calls.prompt).toEqual([{ text: "managed queued", options: undefined }]);
      expect((await service.status(sessionRef(id))).queuedMessages).toEqual([]);
    } finally { await service.dispose(); }
  });

  it("publishes managed runtime reload failures only to its owning scope", async () => {
    const { service, managed, context, events } = await modeService();
    try {
      managed.session.reload = () => Promise.reject(new Error("managed reload failed"));
      await expect(service.runCommand(sessionRef(id), "/reload", context)).resolves.toMatchObject({ type: "unsupported" });
      const failures = events.sessionEvents.filter(({ event }) => event.type === "session.error" && event.message === "managed reload failed");
      expect(failures.map(({ scope }) => scope)).toEqual([eventScopeFromManagementContext(context)]);
    } finally { await service.dispose(); }
  });

  it("cleans an old compaction queue when its runtime identity changes without touching the other mode", async () => {
    const normal = fakeRuntime(id, { isCompacting: true });
    const managed = fakeRuntime(id, { isCompacting: true });
    const reopened = fakeRuntime(id);
    const replacement = fakeRuntime("replacement");
    const context = testManagementContext();
    let rebind: ((session: PiAgentSession) => Promise<void>) | undefined;
    managed.runtime.setRebindSession = (callback) => { rebind = callback; };
    let managedOpened = false;
    const service = new PiSessionService(new ScopeCapturingSessionEventHub(), {
      modelRuntime: testModelRuntime, managementModelRuntime: testModelRuntime,
      sessionManager: sessionGateway([sessionRecord(id)]),
      createAgentRuntime: (_factory, options) => {
        if (options.managementContext === undefined) return Promise.resolve(normal.runtime);
        const runtime = managedOpened ? reopened.runtime : managed.runtime;
        managedOpened = true;
        return Promise.resolve(runtime);
      },
      heartbeatIntervalMs: 60_000,
    });
    try {
      await service.prompt(sessionRef(id), "ordinary queued", "followUp");
      await service.prompt(sessionRef(id), "managed queued", "followUp", undefined, { managementContext: context });
      if (rebind === undefined) throw new Error("Expected managed rebind callback");
      Object.defineProperty(managed.runtime, "session", { configurable: true, value: replacement.session });
      await rebind(replacement.session);
      expect((await service.status(sessionRef(id), context)).queuedMessages).toEqual([]);
      expect((await service.status(sessionRef(id))).queuedMessages.map(({ text }) => text)).toEqual(["ordinary queued"]);
      expect(reopened.calls.prompt).toHaveLength(0);
      expect(replacement.calls.prompt).toHaveLength(0);
    } finally { await service.dispose(); }
  });

  it("isolates tracked list, check and read for normal and management parents with the same ids", async () => {
    const fixture = await trackedModeService();
    const { service, normal, managed, context, parentId, childId } = fixture;
    try {
      await service.status(sessionRef(parentId));
      await service.status(sessionRef(parentId), context);
      expect(await service.listSubsessions(parentId, normal.parentFile)).toEqual([{ sessionId: childId, cwd: "/workspace", status: "idle" }]);
      expect(await service.listSubsessions(parentId, managed.parentFile, context)).toEqual([{ sessionId: childId, cwd: "/workspace", status: "idle" }]);
      expect(await service.checkSubsession(parentId, childId, normal.parentFile)).toMatchObject({ finalText: "ordinary result" });
      expect(await service.checkSubsession(parentId, childId, managed.parentFile, context)).toMatchObject({ finalText: "managed result" });
      expect((await service.readSubsession(parentId, childId, {}, normal.parentFile)).entries[0]?.parts[0]).toMatchObject({ text: "ordinary result" });
      expect((await service.readSubsession(parentId, childId, {}, managed.parentFile, context)).entries[0]?.parts[0]).toMatchObject({ text: "managed result" });
    } finally { await fixture.dispose(); }
  });

  it("reopens only the captured management parent and retains its workbench handle for automatic completion", async () => {
    const fixture = await trackedModeService();
    const { service, normal, managed, context, creates, parentId, childId } = fixture;
    try {
      await service.status(sessionRef(parentId));
      await service.status(sessionRef(parentId), context);
      await service.checkSubsession(parentId, childId, managed.parentFile, context);
      await service.stop(sessionRef(parentId), context);
      const creationCount = creates.length;
      managed.child.session.isStreaming = true;
      managed.child.emit({ type: "agent_start" });
      managed.child.session.isStreaming = false;
      managed.child.emit({ type: "agent_end" });
      await vi.waitFor(() => { expect(managed.parent.calls.sendCustomMessage).toHaveLength(1); });
      expect(normal.parent.calls.sendCustomMessage).toHaveLength(0);
      expect(creates.slice(creationCount)).toHaveLength(1);
      expect(creates.at(-1)?.managementContext).toBe(context);
      expect(workbenchAccessHandle(creates.at(-1)?.managementContext ?? testManagementContext())).toBe("test-access-handle");
    } finally { await fixture.dispose(); }
  });

  it("persists spawn links and child markers only through the originating mode, without persisting permissions", async () => {
    const fixture = await trackedModeService();
    const { service, normal, managed, context, parentId, childId } = fixture;
    try {
      await service.status(sessionRef(parentId));
      await service.status(sessionRef(parentId), context);
      await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: parentId, parentSessionFile: normal.parentFile, prompt: "ordinary task" });
      await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: parentId, parentSessionFile: managed.parentFile, prompt: "managed task", managementContext: context });
      for (const owner of [normal, managed]) {
        expect(owner.parentAppend).toHaveBeenCalledExactlyOnceWith("pi-web.subsession.link", {
          version: 1, spawnedBySessionId: parentId, spawnedSessionId: childId, spawnedSessionFile: owner.childFile, cwd: "/workspace",
        });
        expect(owner.childAppend).toHaveBeenCalledExactlyOnceWith("pi-web.subsession.spawned", {
          version: 1, spawnedBySessionId: parentId, spawnedSessionId: childId,
        });
      }
      expect(normal.child.calls.prompt).toEqual([{ text: "ordinary task", options: undefined }]);
      expect(managed.child.calls.prompt).toEqual([{ text: "managed task", options: undefined }]);
    } finally { await fixture.dispose(); }
  });

  it("keeps working-child summaries and notification arming scoped when one mode stops its child", async () => {
    const fixture = await trackedModeService();
    const { service, normal, managed, context, parentId, childId } = fixture;
    try {
      await service.status(sessionRef(parentId));
      await service.status(sessionRef(parentId), context);
      await service.checkSubsession(parentId, childId, normal.parentFile);
      await service.checkSubsession(parentId, childId, managed.parentFile, context);
      normal.child.session.isStreaming = true;
      managed.child.session.isStreaming = true;
      normal.child.emit({ type: "agent_start" });
      managed.child.emit({ type: "agent_start" });
      normal.child.session.isStreaming = false;
      normal.child.emit({ type: "agent_end" });
      await vi.waitFor(() => { expect(normal.parent.calls.sendCustomMessage).toHaveLength(1); });
      expect(normal.parent.calls.sendCustomMessage[0]?.message.content).toContain("No other tracked subsessions are working.");
      normal.child.session.isStreaming = true;
      normal.child.emit({ type: "agent_start" });
      await service.stop(sessionRef(childId), context);
      normal.child.session.isStreaming = false;
      normal.child.emit({ type: "agent_end" });
      await vi.waitFor(() => { expect(normal.parent.calls.sendCustomMessage).toHaveLength(2); });
      expect(managed.parent.calls.sendCustomMessage).toHaveLength(0);
    } finally { await fixture.dispose(); }
  });

  it("does not let ordinary persisted links grant management access or a management runtime", async () => {
    const fixture = await trackedModeService();
    const { service, normal, context, creates, parentId, childId } = fixture;
    try {
      expect(await service.listSubsessions(parentId, normal.parentFile)).toHaveLength(1);
      expect(await service.listSubsessions(parentId, undefined, context)).toEqual([]);
      await expect(service.checkSubsession(parentId, childId, undefined, context)).rejects.toThrow("not one of your subsessions");
      expect(await service.checkSubsession(parentId, childId, normal.parentFile)).toMatchObject({ finalText: "ordinary result" });
      expect(creates).toHaveLength(1);
      expect(creates[0]?.managementContext).toBeUndefined();
    } finally { await fixture.dispose(); }
  });
});

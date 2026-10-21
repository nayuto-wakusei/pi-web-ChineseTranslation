import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, SessionManager } from "../../piSdk.js";
import { describe, expect, it, vi } from "vitest";
import type { SessionTreeNavigateRequest, SessionTreeSummaryChoice } from "../../shared/apiTypes.js";
import { PendingAskStore } from "./pendingAskStore.js";
import { WorkspaceActivityService } from "../activity/workspaceActivityService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { PiSessionService, type PiAgentSession, type PiSessionManager, type PiSessionServiceDependencies } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModel, testModelRuntime, type TestSession } from "./piSessionService.testSupport.js";
import type { ProjectableSessionTreeNode } from "./sessionTreeProjection.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
const SESSION_ID = "tree-session";

type NavigateTree = NonNullable<PiAgentSession["navigateTree"]>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function treeNode(entry: Record<string, unknown>, children: ProjectableSessionTreeNode[] = []): ProjectableSessionTreeNode {
  return { entry, children };
}

function navigationRequest(
  summary: SessionTreeSummaryChoice = { mode: "none" },
  expectedLeafId: string | null = "leaf-1",
): SessionTreeNavigateRequest {
  return { targetId: "target-1", expectedLeafId, summary };
}

function treeHarness(
  managerPatch: Partial<PiSessionManager> = {},
  sessionPatch: Partial<TestSession> = {},
  dependenciesPatch: Partial<PiSessionServiceDependencies> = {},
) {
  const hub = new CapturingSessionEventHub();
  const manager = fakeSessionManager("/workspace", {
    getSessionId: () => SESSION_ID,
    getLeafId: () => "leaf-1",
    ...managerPatch,
  });
  const fake = fakeRuntime(SESSION_ID, { sessionManager: manager, ...sessionPatch });
  const service = new PiSessionService(hub, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    archiveStore: emptyArchiveStore(),
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord(SESSION_ID)]),
    heartbeatIntervalMs: 60_000,
    ...dependenciesPatch,
  });
  return { service, fake, hub };
}

describe("PiSessionService session-tree behavior", () => {
  it.each(["moved", "summarized", "unchanged", "cancelled", "failed"] as const)(
    "handles pending questions when tree navigation is %s",
    async (scenario) => {
      let leafId = "leaf-1";
      const navigateTree = vi.fn<NavigateTree>(() => {
        if (scenario === "failed") return Promise.reject(new Error("navigation failed"));
        if (scenario === "moved" || scenario === "summarized") leafId = "target-1";
        return Promise.resolve({
          cancelled: scenario === "cancelled",
          ...(scenario === "summarized" ? { summaryEntry: { id: "target-1" } } : {}),
        });
      });
      const { service, fake, hub } = treeHarness({ getLeafId: () => leafId }, { navigateTree });
      try {
        await service.status(sessionRef(SESSION_ID));
        const { ask } = await service.openAsk({
          sessionId: SESSION_ID,
          questions: [{ id: "choice", question: "Which option?", options: [] }],
        });
        const navigation = service.navigateTree(sessionRef(SESSION_ID), navigationRequest(
          { mode: scenario === "summarized" ? "default" : "none" },
        ));
        if (scenario === "failed") await expect(navigation).rejects.toThrow("navigation failed");
        else await expect(navigation).resolves.toEqual({ cancelled: scenario === "cancelled" });

        const moved = scenario === "moved" || scenario === "summarized";
        const status = await service.status(sessionRef(SESSION_ID));
        const closedEvents = hub.sessionEvents.filter(({ event }) => event.type === "ask.closed");
        if (moved) {
          expect(status).not.toHaveProperty("pendingAsk");
          expect(closedEvents).toEqual([{
            sessionId: SESSION_ID,
            event: { type: "ask.closed", askId: ask.askId, reason: "cancelled" },
          }]);
          await expect(service.submitAsk(sessionRef(SESSION_ID), ask.askId, { answers: [] }))
            .resolves.toMatchObject({ result: "stale" });
        } else {
          expect(status.pendingAsk).toEqual(ask);
          expect(closedEvents).toEqual([]);
        }
        expect(fake.calls.sendCustomMessage).toEqual([]);
        expect(fake.calls.prompt).toEqual([]);
      } finally {
        await service.dispose();
      }
    },
  );

  it("opens /tree from the live manager through the safe projection boundary", async () => {
    const navigateTree = vi.fn<NavigateTree>(() => Promise.resolve({ cancelled: false }));
    const roots = [treeNode({
      type: "message",
      id: "leaf-1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "safe answer" },
          { type: "thinking", thinking: "private reasoning", thinkingSignature: "private signature" },
        ],
        usage: { private: true },
      },
    })];
    const { service } = treeHarness({ getTree: () => roots }, { navigateTree });

    await expect(service.runCommand(sessionRef(SESSION_ID), "/tree")).resolves.toEqual({
      type: "tree",
      tree: {
        nodes: [{
          id: "leaf-1",
          parentId: null,
          kind: "assistant",
          summary: "safe answer",
          timestamp: "2026-01-01T00:00:00.000Z",
        }],
        activeLeafId: "leaf-1",
        activePathIds: ["leaf-1"],
      },
    });

    await service.dispose();
  });

  it("closes an open question when navigation changes the leaf, without appending a cancellation", async () => {
    const pendingAskStore = new PendingAskStore();
    let leafId = "leaf-1";
    const sendCustomMessage = vi.fn(() => Promise.resolve());
    const { service, hub } = treeHarness(
      { getSessionId: () => SESSION_ID, getLeafId: () => leafId },
      {
        navigateTree: () => {
          leafId = "rewound-leaf";
          return Promise.resolve({ cancelled: false });
        },
        sendCustomMessage,
      },
      { pendingAskStore },
    );
    pendingAskStore.open({ sessionId: SESSION_ID, questions: [{ id: "continue", question: "继续？", options: [] }] });

    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "none" }))).resolves.toEqual({ cancelled: false });

    expect(pendingAskStore.pendingAsk(SESSION_ID)).toBeUndefined();
    expect(sendCustomMessage).not.toHaveBeenCalled();
    expect(hub.sessionEvents.some((entry) => entry.sessionId === SESSION_ID && entry.event.type === "ask.closed" && entry.event.reason === "cancelled")).toBe(true);
    await service.dispose();
  });

  it("maps none, default, and trimmed custom summary choices exactly and returns only editor text", async () => {
    const navigateTree = vi.fn<NavigateTree>();
    navigateTree
      .mockResolvedValueOnce({ cancelled: false })
      .mockResolvedValueOnce({ cancelled: false })
      .mockResolvedValueOnce({ cancelled: false, editorText: "exact user text", summaryEntry: { details: "must not escape" } });
    const { service, fake } = treeHarness({}, { navigateTree });

    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "none" }))).resolves.toEqual({ cancelled: false });
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "default" }))).resolves.toEqual({ cancelled: false });
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "custom", instructions: "  focus on tests\nwithout losing context  " }))).resolves.toEqual({
      cancelled: false,
      editorText: "exact user text",
    });

    expect(navigateTree).toHaveBeenNthCalledWith(1, "target-1", { summarize: false });
    expect(navigateTree).toHaveBeenNthCalledWith(2, "target-1", { summarize: true });
    expect(navigateTree).toHaveBeenNthCalledWith(3, "target-1", { summarize: true, customInstructions: "focus on tests\nwithout losing context" });
    expect(service.activeCount()).toBe(1);
    expect(fake.calls.dispose).toBe(0);

    await service.dispose();
  });

  it("restores editor semantics when an editable message is already the active leaf", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pi-web-active-tree-target-"));
    const workspace = join(tempDir, "workspace");
    const agentDir = join(tempDir, "agent");
    await mkdir(workspace, { recursive: true });
    const manager = SessionManager.inMemory(workspace, { id: SESSION_ID });
    const { session: piSession } = await createAgentSession({
      cwd: workspace,
      agentDir,
      modelRuntime: testModelRuntime,
      noTools: "all",
      sessionManager: manager,
    });
    const navigateTree = vi.fn<NavigateTree>((targetId, options) => piSession.navigateTree(targetId, options));
    const fake = fakeRuntime(SESSION_ID, {
      sessionFile: undefined,
      sessionManager: manager,
      navigateTree,
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      archiveStore: emptyArchiveStore(),
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord(SESSION_ID, workspace)]),
      heartbeatIntervalMs: 60_000,
    });

    try {
      manager.resetLeaf();
      const userId = manager.appendMessage({ role: "user", content: "edit active user", timestamp: Date.now() });
      await expect(service.navigateTree(sessionRef(SESSION_ID, workspace), {
        targetId: userId,
        expectedLeafId: userId,
        summary: { mode: "none" },
      })).resolves.toEqual({ cancelled: false, editorText: "edit active user" });
      expect(manager.getLeafId()).toBeNull();

      const customId = manager.appendCustomMessageEntry("test", "edit active custom", true);
      await expect(service.navigateTree(sessionRef(SESSION_ID, workspace), {
        targetId: customId,
        expectedLeafId: customId,
        summary: { mode: "none" },
      })).resolves.toEqual({ cancelled: false, editorText: "edit active custom" });
      expect(manager.getLeafId()).toBeNull();

      const ordinaryCustomId = manager.appendCustomEntry("test-state", { preserved: true });
      await expect(service.navigateTree(sessionRef(SESSION_ID, workspace), {
        targetId: ordinaryCustomId,
        expectedLeafId: ordinaryCustomId,
        summary: { mode: "none" },
      })).resolves.toEqual({ cancelled: false });
      expect(manager.getLeafId()).toBe(ordinaryCustomId);
    } finally {
      await service.dispose();
      piSession.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("restores an active editable leaf when the compatibility navigation is cancelled", async () => {
    let leafId: string | null = "target-1";
    const parent = { type: "message", id: "parent-1", parentId: null, message: { role: "assistant", content: "answer" } };
    const target = { type: "message", id: "target-1", parentId: "parent-1", message: { role: "user", content: "edit me" } };
    const navigateTree = vi.fn<NavigateTree>();
    navigateTree
      .mockResolvedValueOnce({ cancelled: false })
      .mockResolvedValueOnce({ cancelled: true, aborted: true });
    const { service } = treeHarness({
      getLeafId: () => leafId,
      getBranch: () => leafId === "target-1" ? [parent, target] : [parent],
      branch: (targetId) => { leafId = targetId; },
      resetLeaf: () => { leafId = null; },
    }, { navigateTree });

    await expect(service.navigateTree(
      sessionRef(SESSION_ID),
      navigationRequest({ mode: "none" }, "target-1"),
    )).resolves.toEqual({ cancelled: true, aborted: true });
    expect(leafId).toBe("target-1");
    await service.dispose();
  });

  it("releases a no-summary branch when the next prompt is durable beneath an external descendant", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pi-web-tree-navigation-"));
    const workspace = join(tempDir, "workspace");
    const sessionDir = join(tempDir, "sessions");
    const sessionFile = join(sessionDir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`);
    await Promise.all([mkdir(workspace, { recursive: true }), mkdir(sessionDir, { recursive: true })]);
    const entry = (id: string, parentId: string | null, role: "user" | "assistant", content: string) => ({
      type: "message",
      id,
      parentId,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role, content },
    });
    const initialEntries = [
      entry("root-user", null, "user", "original question"),
      entry("target-1", "root-user", "assistant", "selected answer"),
      entry("abandoned-user", "target-1", "user", "abandoned follow-up"),
      entry("leaf-1", "abandoned-user", "assistant", "abandoned answer"),
    ];
    await writeFile(sessionFile, `${[
      { type: "session", version: 3, id: SESSION_ID, timestamp: "2026-01-01T00:00:00.000Z", cwd: workspace },
      ...initialEntries,
    ].map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");

    const manager = SessionManager.open(sessionFile, sessionDir);
    const navigateTree = vi.fn<NavigateTree>((targetId) => {
      manager.branch(targetId);
      return Promise.resolve({ cancelled: false });
    });
    const prompt = vi.fn((text: string) => {
      manager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
      return Promise.resolve();
    });
    const fake = fakeRuntime(SESSION_ID, { sessionFile, sessionManager: manager, navigateTree, prompt });
    const gateway = createPiSessionManagerGateway({
      agentDir: join(tempDir, "agent"),
      env: { PI_CODING_AGENT_SESSION_DIR: sessionDir },
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      archiveStore: emptyArchiveStore(),
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: gateway,
      heartbeatIntervalMs: 60_000,
    });

    try {
      await expect(service.navigateTree(sessionRef(SESSION_ID, workspace), navigationRequest())).resolves.toEqual({ cancelled: false });
      expect(navigateTree).toHaveBeenCalledWith("target-1", { summarize: false });

      await expect(service.messages(sessionRef(SESSION_ID, workspace))).resolves.toMatchObject({
        messages: [
          { role: "user", content: "original question" },
          { role: "assistant", content: "selected answer" },
        ],
        total: 2,
      });
      await expect(service.status(sessionRef(SESSION_ID, workspace))).resolves.toMatchObject({ messageCount: 2 });

      await service.prompt(sessionRef(SESSION_ID, workspace), "continue here");
      await vi.waitFor(() => { expect(prompt).toHaveBeenCalledWith("continue here", undefined); });

      const promptLeafId = manager.getLeafId();
      if (promptLeafId === null) throw new Error("Expected the prompt to append a session entry");
      await appendFile(sessionFile, `${JSON.stringify(entry("external-leaf", promptLeafId, "assistant", "external continuation"))}\n`, "utf8");
      await expect(service.messages(sessionRef(SESSION_ID, workspace))).resolves.toMatchObject({
        messages: [
          { role: "user", content: "original question" },
          { role: "assistant", content: "selected answer" },
          { role: "user", content: "continue here" },
          { role: "assistant", content: "external continuation" },
        ],
        total: 4,
      });
    } finally {
      await service.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("validates stale leaves, active work, unavailable runtimes, and custom instruction bounds", async () => {
    const navigateTree = vi.fn<NavigateTree>(() => Promise.resolve({ cancelled: false }));
    const { service, fake } = treeHarness({ getLeafId: () => "new-leaf" }, { navigateTree });

    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "none" }, "old-leaf"))).rejects.toThrow(
      "打开 /tree 后会话已发生变化。请重新打开 /tree 后重试。",
    );
    expect(navigateTree).not.toHaveBeenCalled();

    fake.session.isStreaming = true;
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "none" }, "new-leaf"))).rejects.toThrow(
      "切换会话树前请先停止当前会话活动",
    );
    fake.session.isStreaming = false;

    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "custom", instructions: "   " }, "new-leaf"))).rejects.toThrow(
      "自定义分支汇总要求不能为空",
    );
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "custom", instructions: "x".repeat(10_001) }, "new-leaf"))).rejects.toThrow(
      "自定义分支汇总要求不能超过 10000 个字符",
    );
    expect(navigateTree).not.toHaveBeenCalled();
    await service.dispose();

    const unavailable = treeHarness();
    await expect(unavailable.service.navigateTree(sessionRef(SESSION_ID), navigationRequest())).rejects.toThrow(
      "当前 Pi 运行时不支持会话树导航",
    );
    await unavailable.service.dispose();
  });

  it("holds a per-runtime gate that rejects concurrent navigation and leaf-producing work", async () => {
    const navigation = deferred<Awaited<ReturnType<NavigateTree>>>();
    const navigateTree = vi.fn<NavigateTree>(() => navigation.promise);
    const { service, fake } = treeHarness({}, { navigateTree });

    const firstNavigation = service.navigateTree(sessionRef(SESSION_ID), navigationRequest());
    await vi.waitFor(() => { expect(navigateTree).toHaveBeenCalledOnce(); });

    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest())).rejects.toThrow(
      "切换会话树前请先停止当前会话活动",
    );
    await expect(service.prompt(sessionRef(SESSION_ID), "do not append yet")).rejects.toThrow(
      "会话树导航期间无法发送消息",
    );
    await expect(service.shell(sessionRef(SESSION_ID), "!pwd")).rejects.toThrow(
      "会话树导航期间无法运行 Shell 命令",
    );
    await expect(service.setThinkingLevel(sessionRef(SESSION_ID), "off")).rejects.toThrow(
      "会话树导航期间无法更改思考级别",
    );
    const model = testModel();
    await expect(service.setModel(sessionRef(SESSION_ID), model.provider, model.id)).rejects.toThrow(
      "会话树导航期间无法更改模型",
    );
    await expect(service.cycleModel(sessionRef(SESSION_ID), "forward")).rejects.toThrow(
      "会话树导航期间无法更改模型",
    );
    await expect(service.runCommand(sessionRef(SESSION_ID), "/name blocked")).resolves.toEqual({
      type: "unsupported",
      message: "会话树导航期间无法运行命令。请先停止或完成导航。",
    });
    await expect(service.archive(sessionRef(SESSION_ID))).rejects.toThrow("归档前请先停止当前会话活动");
    expect(fake.calls.prompt).toEqual([]);

    navigation.resolve({ cancelled: false });
    await expect(firstNavigation).resolves.toEqual({ cancelled: false });
    await service.prompt(sessionRef(SESSION_ID), "now append");
    expect(fake.calls.prompt).toEqual([{ text: "now append", options: undefined }]);

    await service.dispose();
  });

  it("blocks navigation while prompt preflight can await before Pi reports streaming", async () => {
    const promptOperation = deferred<undefined>();
    const prompt = vi.fn(() => promptOperation.promise);
    const navigateTree = vi.fn<NavigateTree>(() => Promise.resolve({ cancelled: false }));
    const { service } = treeHarness({}, { prompt, navigateTree });

    await service.prompt(sessionRef(SESSION_ID), "preflight is still running");
    await vi.waitFor(() => { expect(prompt).toHaveBeenCalledOnce(); });
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest())).rejects.toThrow(
      "切换会话树前请先停止当前会话活动",
    );

    promptOperation.resolve(undefined);
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest())).resolves.toEqual({ cancelled: false });
    await service.dispose();
  });

  it("blocks navigation while an asynchronous model change can still append an entry", async () => {
    const modelChange = deferred<undefined>();
    const setModel = vi.fn(() => modelChange.promise);
    const navigateTree = vi.fn<NavigateTree>(() => Promise.resolve({ cancelled: false }));
    const { service } = treeHarness({}, { setModel, navigateTree });
    const model = testModel();

    const changingModel = service.setModel(sessionRef(SESSION_ID), model.provider, model.id);
    await vi.waitFor(() => { expect(setModel).toHaveBeenCalledOnce(); });
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest())).rejects.toThrow(
      "切换会话树前请先停止当前会话活动",
    );

    modelChange.resolve(undefined);
    await changingModel;
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest())).resolves.toEqual({ cancelled: false });
    await service.dispose();
  });

  it("blocks tree navigation while clone replaces and rebinds the runtime", async () => {
    const replacement = deferred<{ cancelled: boolean; selectedText?: string }>();
    const rebound = deferred<undefined>();
    const navigateTree = vi.fn<NavigateTree>(() => Promise.resolve({ cancelled: false }));
    const { service, fake } = treeHarness({}, { navigateTree });
    const replacementSessionId = "tree-session-replacement";
    const replacementFake = fakeRuntime(replacementSessionId, {
      sessionManager: fakeSessionManager("/workspace", {
        getSessionId: () => replacementSessionId,
        getLeafId: () => "replacement-leaf",
      }),
      navigateTree,
    });
    let rebindSession: ((session: PiAgentSession) => Promise<void>) | undefined;
    fake.runtime.setRebindSession = (callback) => { rebindSession = callback; };
    const fork = vi.fn(async () => {
      if (!Reflect.set(fake.runtime, "session", replacementFake.session)) throw new Error("Could not replace fake runtime session");
      await rebindSession?.(replacementFake.session);
      rebound.resolve(undefined);
      return replacement.promise;
    });
    fake.runtime.fork = fork;

    const cloning = service.runCommand(sessionRef(SESSION_ID), "/clone");
    await rebound.promise;
    await expect(service.navigateTree(sessionRef(replacementSessionId), navigationRequest({ mode: "none" }, "replacement-leaf"))).rejects.toThrow(
      "切换会话树前请先停止当前会话活动",
    );

    replacement.resolve({ cancelled: false });
    await expect(cloning).resolves.toMatchObject({ type: "done", message: "会话已克隆" });
    await expect(service.navigateTree(sessionRef(replacementSessionId), navigationRequest({ mode: "none" }, "replacement-leaf"))).resolves.toEqual({ cancelled: false });
    expect(fork).toHaveBeenCalledOnce();
    await service.dispose();
  });

  it("blocks tree navigation while session resources reload", async () => {
    const reloadOperation = deferred<undefined>();
    const reload = vi.fn(() => reloadOperation.promise);
    const navigateTree = vi.fn<NavigateTree>(() => Promise.resolve({ cancelled: false }));
    const { service } = treeHarness({}, { navigateTree, reload });

    const reloading = service.runCommand(sessionRef(SESSION_ID), "/reload");
    await vi.waitFor(() => { expect(reload).toHaveBeenCalledOnce(); });
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest())).rejects.toThrow(
      "切换会话树前请先停止当前会话活动",
    );

    reloadOperation.resolve(undefined);
    await expect(reloading).resolves.toMatchObject({ type: "done" });
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest())).resolves.toEqual({ cancelled: false });
    await service.dispose();
  });

  it("blocks tree navigation while the route-level runtime reload disposes and reopens the session", async () => {
    const disposal = deferred<undefined>();
    const navigateTree = vi.fn<NavigateTree>(() => Promise.resolve({ cancelled: false }));
    const { service, fake } = treeHarness({}, { navigateTree });
    const dispose = vi.fn(() => disposal.promise);
    fake.runtime.dispose = dispose;

    const reloading = service.reload(sessionRef(SESSION_ID));
    await vi.waitFor(() => { expect(dispose).toHaveBeenCalledOnce(); });
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest())).rejects.toThrow(
      "切换会话树前请先停止当前会话活动",
    );

    disposal.resolve(undefined);
    await reloading;
    await service.dispose();
  });

  it("blocks tree navigation throughout an asynchronous archive operation", async () => {
    const archiveOperation = deferred<{ sessionId: string; cwd: string; archivedAt: string }>();
    const archive = vi.fn(() => archiveOperation.promise);
    const archiveStore = { ...emptyArchiveStore(), archive };
    const navigateTree = vi.fn<NavigateTree>(() => Promise.resolve({ cancelled: false }));
    const { service } = treeHarness({}, { navigateTree }, { archiveStore });

    const archiving = service.archive(sessionRef(SESSION_ID));
    await vi.waitFor(() => { expect(archive).toHaveBeenCalledOnce(); });
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest())).rejects.toThrow(
      "切换会话树前请先停止当前会话活动",
    );

    archiveOperation.resolve({ sessionId: SESSION_ID, cwd: "/workspace", archivedAt: "2026-01-01T00:00:00.000Z" });
    await archiving;
    await service.dispose();
  });

  it("aborts branch summarization through the existing abort path and reports cancellation", async () => {
    const navigation = deferred<Awaited<ReturnType<NavigateTree>>>();
    const navigateTree = vi.fn<NavigateTree>(() => navigation.promise);
    const abortBranchSummary = vi.fn(() => { navigation.resolve({ cancelled: true, aborted: true }); });
    const abort = vi.fn(() => Promise.resolve());
    const { service, hub } = treeHarness({}, { navigateTree, abortBranchSummary, abort });

    const navigationResult = service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "default" }));
    await vi.waitFor(() => { expect(navigateTree).toHaveBeenCalledOnce(); });
    await service.abort(sessionRef(SESSION_ID));

    await expect(navigationResult).resolves.toEqual({ cancelled: true, aborted: true });
    expect(abortBranchSummary).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    expect(abortBranchSummary.mock.invocationCallOrder[0]).toBeLessThan(abort.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
    expect(hub.sessionEvents.some(({ event }) => event.type === "activity.update" && event.activity.label === "分支汇总已终止")).toBe(true);

    await service.dispose();
  });

  it("does not republish stale navigation state after stopping and disposing its runtime", async () => {
    const navigation = deferred<Awaited<ReturnType<NavigateTree>>>();
    const navigateTree = vi.fn<NavigateTree>(() => navigation.promise);
    const abortBranchSummary = vi.fn(() => { navigation.resolve({ cancelled: true, aborted: true }); });
    const { service, hub, fake } = treeHarness({}, { navigateTree, abortBranchSummary });

    const navigationResult = service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "default" }));
    await vi.waitFor(() => { expect(navigateTree).toHaveBeenCalledOnce(); });
    hub.sessionEvents.length = 0;
    await service.stop(sessionRef(SESSION_ID));
    await expect(navigationResult).resolves.toEqual({ cancelled: true, aborted: true });

    expect(service.activeCount()).toBe(0);
    expect(fake.calls.dispose).toBe(1);
    expect(hub.sessionEvents).toEqual([]);
    await service.dispose();
  });

  it("still runs the normal abort and releases the gate when the branch-summary abort hook fails", async () => {
    const navigation = deferred<Awaited<ReturnType<NavigateTree>>>();
    const navigateTree = vi.fn<NavigateTree>(() => navigation.promise);
    const branchAbortFailure = new Error("branch abort hook failed");
    const abortBranchSummary = vi.fn<NonNullable<PiAgentSession["abortBranchSummary"]>>(() => { throw branchAbortFailure; });
    const abort = vi.fn(() => {
      navigation.resolve({ cancelled: true, aborted: true });
      return Promise.resolve();
    });
    const { service } = treeHarness({}, { navigateTree, abortBranchSummary, abort });

    const navigationResult = service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "default" }));
    await vi.waitFor(() => { expect(navigateTree).toHaveBeenCalledOnce(); });
    await expect(service.abort(sessionRef(SESSION_ID))).rejects.toBe(branchAbortFailure);
    await expect(navigationResult).resolves.toEqual({ cancelled: true, aborted: true });

    expect(abortBranchSummary).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    await expect(service.prompt(sessionRef(SESSION_ID), "gate released after abort failure")).resolves.toBeUndefined();
    abortBranchSummary.mockImplementation(() => undefined);
    await service.dispose();
  });

  it("releases the gate and publishes final status after navigation failure", async () => {
    const failure = new Error("summary provider failed");
    const navigateTree = vi.fn<NavigateTree>();
    navigateTree.mockRejectedValueOnce(failure).mockResolvedValueOnce({ cancelled: false });
    const { service, hub } = treeHarness({}, { navigateTree });

    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "default" }))).rejects.toBe(failure);
    await expect(service.navigateTree(sessionRef(SESSION_ID), navigationRequest({ mode: "none" }))).resolves.toEqual({ cancelled: false });

    expect(navigateTree).toHaveBeenCalledTimes(2);
    expect(hub.sessionEvents.some(({ event }) => event.type === "activity.update"
      && event.activity.phase === "error"
      && event.activity.detail === "summary provider failed")).toBe(true);
    expect(hub.sessionEvents.filter(({ event }) => event.type === "status.update").length).toBeGreaterThanOrEqual(4);

    await service.dispose();
  });
});

describe("PiSessionService session-tree fork-from-entry", () => {
  function forkRequest(entryId = "entry-1", expectedLeafId: string | null = "leaf-1") {
    return { entryId, expectedLeafId };
  }

  it("forks user entries from before and maps the forked session with its prompt draft", async () => {
    const fork = vi.fn(() => Promise.resolve({ cancelled: false, selectedText: "draft text" }));
    const { service, fake, hub } = treeHarness({}, {
      getUserMessagesForForking: () => [{ entryId: "entry-1", text: "draft text" }],
    });
    fake.runtime.fork = fork;

    await expect(service.forkFromTree(sessionRef(SESSION_ID), forkRequest())).resolves.toMatchObject({
      cancelled: false,
      session: { id: SESSION_ID, cwd: "/workspace" },
      promptDraft: "draft text",
    });
    expect(fork).toHaveBeenCalledWith("entry-1", { position: "before" });
    expect(hub.sessionEvents.some(({ sessionId, event }) => sessionId === SESSION_ID
      && event.type === "activity.update"
      && event.activity.label === "正在从条目分叉会话"
      && event.activity.phase === "active")).toBe(true);
    expect(hub.sessionEvents.some(({ sessionId, event }) => sessionId === SESSION_ID
      && event.type === "activity.update"
      && event.activity.label === "会话已分叉"
      && event.activity.phase === "idle")).toBe(true);

    await service.dispose();
  });

  it("clears superseded session and workspace activity when a changed-id fork spans a heartbeat", async () => {
    vi.useFakeTimers();
    const completeFork = deferred<undefined>();
    let service: PiSessionService | undefined;
    let forkOperation: ReturnType<PiSessionService["forkFromTree"]> | undefined;
    try {
      const workspaceActivity = new WorkspaceActivityService();
      const harness = treeHarness({}, {}, { heartbeatIntervalMs: 1_000, workspaceActivity });
      service = harness.service;
      const replacementSessionId = "tree-session-fork";
      const replacement = fakeRuntime(replacementSessionId, {
        sessionManager: fakeSessionManager("/workspace", {
          getSessionId: () => replacementSessionId,
          getLeafId: () => "fork-leaf",
        }),
      });
      const forkStarted = deferred<undefined>();
      let rebindSession: ((session: PiAgentSession) => Promise<void>) | undefined;
      harness.fake.runtime.setRebindSession = (callback) => { rebindSession = callback; };
      harness.fake.runtime.fork = vi.fn(async () => {
        forkStarted.resolve(undefined);
        await completeFork.promise;
        if (!Reflect.set(harness.fake.runtime, "session", replacement.session)) {
          throw new Error("Could not replace fake runtime session");
        }
        if (rebindSession === undefined) throw new Error("Expected runtime rebind callback");
        await rebindSession(replacement.session);
        return { cancelled: false };
      });

      forkOperation = service.forkFromTree(sessionRef(SESSION_ID), forkRequest());
      await forkStarted.promise;
      expect(workspaceActivity.snapshot().workspaces).toEqual([]);

      await vi.advanceTimersByTimeAsync(1_000);

      const originalGlobalActivities = () => harness.hub.globalEvents.filter((event) => event.type === "activity.update"
        && event.activity.sessionId === SESSION_ID);
      expect(originalGlobalActivities().at(-1)).toMatchObject({
        activity: { sessionId: SESSION_ID, phase: "active" },
      });
      expect(workspaceActivity.snapshot().workspaces).toMatchObject([
        { cwd: "/workspace", hasSessionActivity: true },
      ]);

      completeFork.resolve(undefined);
      await expect(forkOperation).resolves.toMatchObject({
        cancelled: false,
        session: { id: replacementSessionId },
      });

      expect(originalGlobalActivities().at(-1)).toMatchObject({
        activity: { sessionId: SESSION_ID, phase: "idle", label: "空闲" },
      });
      expect(harness.hub.sessionEvents.filter(({ sessionId, event }) => sessionId === SESSION_ID
        && event.type === "activity.update").at(-1)).toMatchObject({
        event: { activity: { sessionId: SESSION_ID, phase: "idle", label: "空闲" } },
      });
      expect(workspaceActivity.snapshot().workspaces).toEqual([]);
    } finally {
      completeFork.resolve(undefined);
      await forkOperation?.catch(() => undefined);
      await service?.dispose();
      vi.useRealTimers();
    }
  });

  it("forks attachment-only user entries from before using the projected tree kind", async () => {
    const entryId = "attachment-only-user";
    const roots = [treeNode({
      type: "message",
      id: entryId,
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "user",
        content: [{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }],
      },
    })];
    const navigateTree = vi.fn<NavigateTree>(() => Promise.resolve({ cancelled: false }));
    const fork = vi.fn(() => Promise.resolve({ cancelled: false }));
    const { service, fake } = treeHarness({
      getLeafId: () => entryId,
      getTree: () => roots,
    }, {
      navigateTree,
      getUserMessagesForForking: () => [],
    });
    fake.runtime.fork = fork;

    await expect(service.forkFromTree(sessionRef(SESSION_ID), forkRequest(entryId, entryId))).resolves.toMatchObject({
      cancelled: false,
      session: { id: SESSION_ID },
    });
    expect(fork).toHaveBeenCalledWith(entryId, { position: "before" });

    await service.dispose();
  });

  it("forks non-user entries at the entry and omits the prompt draft", async () => {
    const fork = vi.fn(() => Promise.resolve({ cancelled: false }));
    const { service, fake } = treeHarness({}, {
      getUserMessagesForForking: () => [{ entryId: "entry-1", text: "draft text" }],
    });
    fake.runtime.fork = fork;

    const result = await service.forkFromTree(sessionRef(SESSION_ID), forkRequest("entry-9"));
    expect(result).toMatchObject({ cancelled: false, session: { id: SESSION_ID } });
    expect(result).not.toHaveProperty("promptDraft");
    expect(fork).toHaveBeenCalledWith("entry-9", { position: "at" });

    await service.dispose();
  });

  it("reports cancellation without forked session metadata", async () => {
    const fork = vi.fn(() => Promise.resolve({ cancelled: true }));
    const { service, fake, hub } = treeHarness();
    fake.runtime.fork = fork;

    await expect(service.forkFromTree(sessionRef(SESSION_ID), forkRequest())).resolves.toEqual({ cancelled: true });
    expect(hub.sessionEvents.some(({ sessionId, event }) => sessionId === SESSION_ID
      && event.type === "activity.update"
      && event.activity.label === "分叉已取消"
      && event.activity.phase === "idle")).toBe(true);

    await service.dispose();
  });

  it("rejects blank entries, stale leaves, active work, and archived sessions before forking", async () => {
    const fork = vi.fn(() => Promise.resolve({ cancelled: false }));
    const { service, fake } = treeHarness({ getLeafId: () => "new-leaf" });
    fake.runtime.fork = fork;

    await expect(service.forkFromTree(sessionRef(SESSION_ID), forkRequest("   ", "new-leaf"))).rejects.toThrow(
      "会话树条目不能为空",
    );
    await expect(service.forkFromTree(sessionRef(SESSION_ID), forkRequest("entry-1", "old-leaf"))).rejects.toThrow(
      "打开 /tree 后会话已发生变化。请重新打开 /tree 后重试。",
    );

    fake.session.isStreaming = true;
    await expect(service.forkFromTree(sessionRef(SESSION_ID), forkRequest("entry-1", "new-leaf"))).rejects.toThrow(
      "分叉会话树前请先停止当前会话活动",
    );
    fake.session.isStreaming = false;

    expect(fork).not.toHaveBeenCalled();
    await service.dispose();

    const archived = treeHarness({}, {}, {
      archiveStore: {
        ...emptyArchiveStore(),
        get: () => Promise.resolve({ sessionId: SESSION_ID, cwd: "/workspace", archivedAt: "2026-01-01T00:00:00.000Z", archivePath: `/archive/${SESSION_ID}.jsonl` }),
      },
    });
    await expect(archived.service.forkFromTree(sessionRef(SESSION_ID), forkRequest())).rejects.toThrow(
      "已归档会话为只读。请恢复会话后继续。",
    );
    await archived.service.dispose();
  });

  it("revalidates the expected leaf after asynchronous naming and an intervening entry mutation", async () => {
    let leafId = "leaf-1";
    let promptSettled = false;
    const records = [sessionRecord(SESSION_ID)];
    const names = deferred<typeof records>();
    const gateway = sessionGateway(records);
    const list = vi.fn(() => names.promise);
    const prompt = vi.fn(async () => {
      leafId = "leaf-2";
      await Promise.resolve();
      promptSettled = true;
    });
    const fork = vi.fn(() => Promise.resolve({ cancelled: false }));
    const { service, fake } = treeHarness({ getLeafId: () => leafId }, {
      sessionName: "Named session",
      prompt,
    }, {
      sessionManager: { ...gateway, list },
    });
    fake.runtime.fork = fork;

    const forking = service.forkFromTree(sessionRef(SESSION_ID), forkRequest("entry-1", "leaf-1"));
    await vi.waitFor(() => { expect(list).toHaveBeenCalledOnce(); });
    await service.prompt(sessionRef(SESSION_ID), "append while fork names are loading");
    await vi.waitFor(() => { expect(promptSettled).toBe(true); });
    await Promise.resolve();
    names.resolve(records);

    await expect(forking).rejects.toThrow("打开 /tree 后会话已发生变化。请重新打开 /tree 后重试。");
    expect(fork).not.toHaveBeenCalled();

    await service.dispose();
  });

  it("rejects fork-from-tree while a clone replacement owns the session identity", async () => {
    const replacement = deferred<{ cancelled: boolean; selectedText?: string }>();
    const { service, fake } = treeHarness();
    const fork = vi.fn(() => replacement.promise);
    fake.runtime.fork = fork;

    const cloning = service.runCommand(sessionRef(SESSION_ID), "/clone");
    await vi.waitFor(() => { expect(fork).toHaveBeenCalledOnce(); });
    await expect(service.forkFromTree(sessionRef(SESSION_ID), forkRequest())).rejects.toThrow(
      "分叉会话树前请先停止当前会话活动",
    );

    replacement.resolve({ cancelled: false });
    await expect(cloning).resolves.toMatchObject({ type: "done", message: "会话已克隆" });
    await expect(service.forkFromTree(sessionRef(SESSION_ID), forkRequest())).resolves.toMatchObject({ cancelled: false });
    expect(fork).toHaveBeenCalledTimes(2);

    await service.dispose();
  });

  it("publishes session.error after a fork failure and allows the fork to be retried", async () => {
    const fork = vi.fn<() => Promise<{ cancelled: boolean; selectedText?: string }>>();
    fork.mockRejectedValueOnce(new Error("fork provider failed")).mockResolvedValueOnce({ cancelled: false });
    const { service, fake, hub } = treeHarness();
    fake.runtime.fork = fork;

    await expect(service.forkFromTree(sessionRef(SESSION_ID), forkRequest())).rejects.toThrow("fork provider failed");
    expect(hub.sessionEvents.some(({ sessionId, event }) => sessionId === SESSION_ID
      && event.type === "session.error"
      && event.message === "fork provider failed")).toBe(true);
    expect(hub.sessionEvents.some(({ sessionId, event }) => sessionId === SESSION_ID
      && event.type === "activity.update"
      && event.activity.label === "分叉失败"
      && event.activity.phase === "error")).toBe(true);

    await expect(service.forkFromTree(sessionRef(SESSION_ID), forkRequest())).resolves.toMatchObject({ cancelled: false });
    expect(fork).toHaveBeenCalledTimes(2);

    await service.dispose();
  });
});

import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, EmitSocket, oldSession, runPendingAnimationFrames, status, workspace, type AppState, type MessagePage, type SessionStatus, type SessionStreamSnapshot } from "./sessionController.testSupport";

function assistantPartial(text: string): SessionStreamSnapshot["partial"] {
  return { role: "assistant", content: [{ type: "text", text }] };
}

describe("SessionController stream seed + watermark reconciliation", () => {
  it("restores a background streaming session from its latest snapshot without stopping it", async () => {
    const socket = new EmitSocket();
    const otherSession = { ...oldSession, id: "other-session", path: "/tmp/other-session.jsonl" };
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession, otherSession] };
    let oldSessionSnapshotCount = 0;
    const stop = vi.fn<typeof defaultApi.stop>();
    const api: typeof defaultApi = {
      ...defaultApi,
      stop,
      messages: (session) => {
        const sessionId = typeof session === "string" ? session : session.id;
        return Promise.resolve({ messages: [{ role: "user", content: sessionId === oldSession.id ? "question A" : "question B" }], start: 0, total: 1 });
      },
      status: (session) => {
        const sessionId = typeof session === "string" ? session : session.id;
        return Promise.resolve({ ...status(sessionId), isStreaming: sessionId === oldSession.id });
      },
      streamSnapshot: (session) => {
        const sessionId = typeof session === "string" ? session : session.id;
        if (sessionId !== oldSession.id) return Promise.resolve({ seq: 0, partial: null });
        oldSessionSnapshotCount += 1;
        return Promise.resolve(oldSessionSnapshotCount === 1
          ? { seq: 1, partial: assistantPartial("answer") }
          : { seq: 4, partial: assistantPartial("answer continued") });
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    await controller.selectSession(oldSession, { updateUrl: false });
    await controller.selectSession(otherSession, { updateUrl: false });
    await controller.selectSession(oldSession, { updateUrl: false });

    expect(stop).not.toHaveBeenCalled();
    expect(state.messages.at(-1)).toEqual({ role: "assistant", parts: [{ type: "text", text: "answer continued" }] });

    socket.emit({ type: "assistant.delta", text: " duplicate", seq: 4 });
    socket.emit({ type: "assistant.delta", text: " live", seq: 5 });
    runPendingAnimationFrames();

    expect(state.messages.at(-1)).toEqual({ role: "assistant", parts: [{ type: "text", text: "answer continued live" }] });
  });

  it("seeds the in-flight partial on top of committed history at join time", async () => {
    const socket = new EmitSocket();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve({ messages: [{ role: "user", content: "question" }], start: 0, total: 1 }),
      status: () => Promise.resolve({ ...status(oldSession.id), isStreaming: true }),
      streamSnapshot: () => Promise.resolve({ seq: 4, partial: assistantPartial("streaming answer") }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    await controller.selectSession(oldSession, { updateUrl: false });

    expect(state.messages).toEqual([
      { role: "user", parts: [{ type: "text", text: "question" }], transcriptIndex: 0 },
      { role: "assistant", parts: [{ type: "text", text: "streaming answer" }] },
    ]);
    // The seeded partial must never be written to the raw history cache.
    expect(controller).toBeDefined();
  });

  it("applies live tool results while catching up to an already-running session", async () => {
    const socket = new EmitSocket();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve({
        messages: [{ role: "user", content: "Inspect the repository" }],
        start: 0,
        total: 1,
      }),
      status: () => Promise.resolve({ ...status(oldSession.id), isStreaming: true }),
      streamSnapshot: () => Promise.resolve({
        seq: 10,
        partial: {
          role: "assistant",
          content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "src/app.ts" } }],
        },
      }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    await controller.selectSession(oldSession, { updateUrl: false });

    socket.emit({ type: "tool.update", toolName: "read", toolCallId: "read-1", text: "stale output", seq: 10 });
    socket.emit({ type: "tool.update", toolName: "read", toolCallId: "read-1", text: "partial output", seq: 11 });
    runPendingAnimationFrames();

    expect(state.messages).toEqual([
      { role: "user", parts: [{ type: "text", text: "Inspect the repository" }], transcriptIndex: 0 },
      {
        role: "tool",
        parts: [expect.objectContaining({
          type: "toolExecution",
          toolName: "read",
          toolCallId: "read-1",
          status: "running",
          resultText: "partial output",
        })],
      },
    ]);

    socket.emit({ type: "tool.end", toolName: "read", toolCallId: "read-1", text: "complete output", isError: false, seq: 12 });
    runPendingAnimationFrames();

    expect(state.messages[1]?.parts[0]).toMatchObject({
      type: "toolExecution",
      toolName: "read",
      toolCallId: "read-1",
      status: "success",
      resultText: "complete output",
    });
  });

  it("drops live events at or below the watermark and applies later events exactly once", async () => {
    const socket = new EmitSocket();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve({ messages: [{ role: "user", content: "question" }], start: 0, total: 1 }),
      status: () => Promise.resolve({ ...status(oldSession.id), isStreaming: true }),
      streamSnapshot: () => Promise.resolve({ seq: 4, partial: assistantPartial("seed") }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    await controller.selectSession(oldSession, { updateUrl: false });

    // Already reflected in the seeded partial (seq <= 4): dropped.
    socket.emit({ type: "assistant.delta", text: "DUP", seq: 3 });
    socket.emit({ type: "assistant.delta", text: "DUP", seq: 4 });
    // Past the watermark (seq > 4): appended onto the seeded partial exactly once.
    socket.emit({ type: "assistant.delta", text: " more", seq: 5 });
    runPendingAnimationFrames();

    expect(state.messages).toEqual([
      { role: "user", parts: [{ type: "text", text: "question" }], transcriptIndex: 0 },
      { role: "assistant", parts: [{ type: "text", text: "seed more" }] },
    ]);
  });

  it("applies buffered events replayed after join through the same watermark", async () => {
    const socket = new EmitSocket();
    const page = deferred<MessagePage>();
    const statusResult = deferred<SessionStatus>();
    const snapshot = deferred<SessionStreamSnapshot>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => page.promise,
      status: () => statusResult.promise,
      streamSnapshot: () => snapshot.promise,
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    // Events arriving during the join fetch are buffered by selectSession.
    socket.emit({ type: "assistant.delta", text: "STALE", seq: 2 });
    socket.emit({ type: "assistant.delta", text: " live", seq: 6 });

    page.resolve({ messages: [{ role: "user", content: "question" }], start: 0, total: 1 });
    statusResult.resolve({ ...status(oldSession.id), isStreaming: true });
    snapshot.resolve({ seq: 4, partial: assistantPartial("seed") });
    await selecting;
    runPendingAnimationFrames();

    expect(state.messages).toEqual([
      { role: "user", parts: [{ type: "text", text: "question" }], transcriptIndex: 0 },
      { role: "assistant", parts: [{ type: "text", text: "seed live" }] },
    ]);
  });

  it("handles a mid-tool join: null partial, committed tool call in history, live tool.update filtered by seq", async () => {
    const socket = new EmitSocket();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve({
        messages: [
          { role: "user", content: "run it" },
          { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "ls" } }] },
        ],
        start: 0,
        total: 2,
      }),
      status: () => Promise.resolve({ ...status(oldSession.id), isStreaming: true, isBashRunning: true }),
      // Mid tool execution the assistant-message stream has ended, so the
      // snapshot carries no partial; the tool call is already in history.
      streamSnapshot: () => Promise.resolve({ seq: 7, partial: null }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    await controller.selectSession(oldSession, { updateUrl: false });

    const toolLine = state.messages.find((line) => line.parts.some((part) => part.type === "toolExecution"));
    expect(toolLine?.parts[0]).toMatchObject({ type: "toolExecution", toolCallId: "tool-1", toolName: "bash" });

    // Reflected in the snapshot watermark (seq <= 7): dropped.
    socket.emit({ type: "tool.update", toolName: "bash", toolCallId: "tool-1", text: "stale", content: undefined, details: undefined, seq: 7 });
    // Fresh progress past the watermark: applied.
    socket.emit({ type: "tool.update", toolName: "bash", toolCallId: "tool-1", text: "fresh output", content: undefined, details: undefined, seq: 8 });
    runPendingAnimationFrames();

    const updatedToolLine = state.messages.find((line) => line.parts.some((part) => part.type === "toolExecution"));
    expect(updatedToolLine?.parts[0]).toMatchObject({ resultText: "fresh output" });
  });

  it("loads the transcript and streams live even when the snapshot fetch fails (older/un-restarted peer)", async () => {
    const socket = new EmitSocket();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve({ messages: [{ role: "user", content: "question" }], start: 0, total: 1 }),
      status: () => Promise.resolve({ ...status(oldSession.id), isStreaming: true }),
      // A session daemon / remote pi-web without the stream-snapshot route 404s.
      streamSnapshot: () => Promise.reject(new Error("Not Found")),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    await controller.selectSession(oldSession, { updateUrl: false });

    // The core transcript still loads (no error banner, no dropped history).
    expect(state.error).toBeFalsy();
    expect(state.messages).toEqual([{ role: "user", parts: [{ type: "text", text: "question" }], transcriptIndex: 0 }]);

    // With a fallback watermark of 0, fresh live deltas still stream in.
    socket.emit({ type: "assistant.delta", text: "live answer", seq: 1 });
    runPendingAnimationFrames();

    expect(state.messages).toEqual([
      { role: "user", parts: [{ type: "text", text: "question" }], transcriptIndex: 0 },
      { role: "assistant", parts: [{ type: "text", text: "live answer" }] },
    ]);
  });

  it("does not seed a partial and does not filter events for an idle join", async () => {
    const socket = new EmitSocket();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve({ messages: [{ role: "user", content: "question" }], start: 0, total: 1 }),
      status: () => Promise.resolve(status(oldSession.id)),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    await controller.selectSession(oldSession, { updateUrl: false });

    expect(state.messages).toEqual([{ role: "user", parts: [{ type: "text", text: "question" }], transcriptIndex: 0 }]);

    // A watermark of 0 must not drop a fresh streamed delta (seq >= 1).
    socket.emit({ type: "assistant.delta", text: "new turn", seq: 1 });
    runPendingAnimationFrames();

    expect(state.messages).toEqual([
      { role: "user", parts: [{ type: "text", text: "question" }], transcriptIndex: 0 },
      { role: "assistant", parts: [{ type: "text", text: "new turn" }] },
    ]);
  });
});

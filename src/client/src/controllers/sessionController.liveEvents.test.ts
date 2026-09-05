import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { defaultApi, createSessionControllerTestFixture, EmitSocket, emptyPage, FakeSocket, oldSession, runPendingAnimationFrames, status, workspace, type AppState, type SessionActivity, type SessionInfo } from "./sessionController.testSupport";

describe("SessionController live events", () => {
  it("forwards model-scope invalidations to the host", () => {
    const onModelScopeChanged = vi.fn();
    const { controller } = createSessionControllerTestFixture({ dependencies: { onModelScopeChanged } });

    controller.applyGlobalEvent({ type: "models.changed", revision: 3 });

    expect(onModelScopeChanged).toHaveBeenCalledWith(3);
  });

  it("coalesces rapid status updates into a single state write per frame", () => {
    const fixture = createSessionControllerTestFixture({ initialState: { ...initialAppState(), selectedSession: oldSession, sessions: [oldSession] }, socket: new FakeSocket() });
    const { controller } = fixture;

    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 1 } });
    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 2 } });
    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 3 } });

    // Nothing applies until the frame is flushed; last-write-wins per session.
    expect(fixture.stateWrites).toHaveLength(0);
    expect(fixture.state.sessionStatuses[oldSession.id]).toBeUndefined();

    runPendingAnimationFrames();

    expect(fixture.stateWrites).toHaveLength(1);
    expect(fixture.state.sessionStatuses[oldSession.id]).toMatchObject({ sessionId: oldSession.id, messageCount: 3 });
    expect(fixture.state.status?.messageCount).toBe(3);
  });

  it("applies the latest activity per session on flush", () => {
    const fixture = createSessionControllerTestFixture({ initialState: { ...initialAppState(), selectedSession: oldSession, sessions: [oldSession] }, socket: new FakeSocket() });
    const { controller } = fixture;

    controller.applyGlobalEvent({ type: "activity.update", activity: { sessionId: oldSession.id, phase: "active", label: "running tool", at: "t1" } });
    controller.applyGlobalEvent({ type: "activity.update", activity: { sessionId: oldSession.id, phase: "idle", label: "idle", at: "t2" } });

    expect(fixture.stateWrites).toHaveLength(0);

    controller.flushPendingUpdates();

    expect(fixture.state.sessionActivities[oldSession.id]).toMatchObject({ phase: "idle", label: "idle" });
    expect(fixture.state.activity?.phase).toBe("idle");
  });

  it("coalesces status updates delivered over the per-session socket until the frame is flushed", async () => {
    const socket = new EmitSocket();
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const api = {
      messages: () => Promise.resolve(emptyPage),
      status: () => Promise.resolve(status(oldSession.id)),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket });
    const { controller } = fixture;
    await controller.selectSession(oldSession, { updateUrl: false });

    socket.emit({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 7 } });
    socket.emit({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 8 } });

    // Buffered, not applied synchronously.
    expect(fixture.state.sessionStatuses[oldSession.id]?.messageCount).toBeUndefined();

    controller.flushPendingUpdates();

    expect(fixture.state.sessionStatuses[oldSession.id]?.messageCount).toBe(8);
    expect(fixture.state.status?.messageCount).toBe(8);
  });

  it("clears stale active activity when an idle status arrives", () => {
    const activeActivity: SessionActivity = { sessionId: oldSession.id, phase: "active", label: "running tool", at: "2026-05-15T00:00:00.000Z" };
    const state: AppState = {
      ...initialAppState(),
      selectedSession: oldSession,
      sessions: [oldSession],
      activity: activeActivity,
      sessionActivities: { [oldSession.id]: activeActivity },
    };
    const fixture = createSessionControllerTestFixture({ initialState: state, socket: new FakeSocket() });
    const { controller } = fixture;

    controller.applyGlobalEvent({ type: "status.update", status: status(oldSession.id) });
    controller.flushPendingUpdates();

    expect(fixture.state.activity).toBeUndefined();
    expect(fixture.state.sessionActivities[oldSession.id]).toBeUndefined();
    expect(fixture.state.sessionStatuses[oldSession.id]).toMatchObject({ sessionId: oldSession.id, isStreaming: false });
  });

  it("updates visible session message counts from live status events", () => {
    const state: AppState = {
      ...initialAppState(),
      selectedSession: oldSession,
      sessions: [oldSession],
    };
    const fixture = createSessionControllerTestFixture({ initialState: state, socket: new FakeSocket() });
    const { controller } = fixture;

    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), messageCount: 3 } });
    controller.flushPendingUpdates();

    expect(fixture.state.sessions[0]?.messageCount).toBe(3);
    expect(fixture.state.selectedSession?.messageCount).toBe(3);
  });

  it("adds a newly created session to the list when it belongs to the selected workspace", () => {
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const fixture = createSessionControllerTestFixture({ initialState: state, socket: new FakeSocket() });
    const { controller } = fixture;
    const spawned: SessionInfo = { ...oldSession, id: "spawned-session", path: "/tmp/spawned-session.jsonl" };

    controller.applyGlobalEvent({ type: "session.created", session: spawned });

    expect(fixture.state.sessions.map((session) => session.id)).toEqual(["spawned-session", "old-session"]);
  });

  it("ignores a created session for a different workspace or a duplicate id", () => {
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const fixture = createSessionControllerTestFixture({ initialState: state, socket: new FakeSocket() });
    const { controller } = fixture;

    controller.applyGlobalEvent({ type: "session.created", session: { ...oldSession, id: "other", cwd: "/other-repo" } });
    controller.applyGlobalEvent({ type: "session.created", session: { ...oldSession } });

    expect(fixture.state.sessions.map((session) => session.id)).toEqual(["old-session"]);
  });
});

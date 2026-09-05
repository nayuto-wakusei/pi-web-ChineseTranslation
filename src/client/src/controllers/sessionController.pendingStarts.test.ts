import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { isCachedNewSessionInfo, loadCachedNewSessions } from "../cachedNewSessions";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import type { SessionController } from "./sessionController";
import { createSessionControllerTestFixture, defaultApi, deferred, emptyPage, FakeSocket, MemoryStorage, oldSession, sessionKey, sessionLookupId, status, workspace, type AppState, type SessionInfo } from "./sessionController.testSupport";

describe("SessionController pending starts", () => {
  it("creates and selects a temporary editable session before backend start resolves", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const messageCalls: string[] = [];
    const statusCalls: string[] = [];
    const initialState: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api = {
      startSession: () => startRequest.promise,
      messages: (session) => { messageCalls.push(sessionLookupId(session)); return Promise.resolve(emptyPage); },
      status: (session) => { statusCalls.push(sessionLookupId(session)); return Promise.resolve(status(sessionLookupId(session))); },
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState, api, socket: new FakeSocket() });
    const { controller } = fixture;

    const start = controller.startSession();
    const temporarySession = fixture.state.selectedSession;

    expect(fixture.state).not.toBe(initialState);
    expect(initialState.sessions).toEqual([]);
    expect(temporarySession?.id).toMatch(/^pending-session-/);
    expect(temporarySession?.persisted).toBe(false);
    expect(fixture.state.sessions.map((session) => session.id)).toEqual([temporarySession?.id]);
    expect(fixture.state.activity).toMatchObject({ sessionId: temporarySession?.id, phase: "active", label: "正在创建会话" });
    expect(messageCalls).toEqual([]);
    expect(statusCalls).toEqual([]);

    startRequest.resolve(started);
    await start;

    expect(fixture.state.sessions.map((session) => session.id)).toEqual(["started-session"]);
    expect(fixture.state.selectedSession?.id).toBe("started-session");
    expect(messageCalls).toEqual(["started-session"]);
    expect(statusCalls).toEqual(["started-session"]);
  });

  it("does not duplicate a started session when its session.created broadcast races the HTTP response", async () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const socket = new FakeSocket();
    const controllerRef: { current?: SessionController } = {};
    const api = {
      startSession: () => {
        // Simulate the broadcast arriving before the HTTP response resolves.
        controllerRef.current?.applyGlobalEvent({ type: "session.created", session: started });
        return startRequest.promise;
      },
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket });
    controllerRef.current = fixture.controller;
    const { controller } = fixture;

    const start = controller.startSession();
    const temporaryId = fixture.state.selectedSession?.id;

    expect(fixture.state.sessions.map((session) => session.id)).toEqual([temporaryId]);

    startRequest.resolve(started);
    await start;

    expect(fixture.state.sessions.map((session) => session.id)).toEqual(["started-session"]);
    expect(isCachedNewSessionInfo(fixture.state.sessions[0])).toBe(true);
  });

  it("releases unrelated created-session broadcasts after pending starts settle", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const otherClientSession: SessionInfo = { ...oldSession, id: "other-client-session", path: "/tmp/other-client-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api = {
      startSession: () => startRequest.promise,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket: new FakeSocket() });
    const { controller } = fixture;

    const start = controller.startSession();
    const temporaryId = fixture.state.selectedSession?.id;
    controller.applyGlobalEvent({ type: "session.created", session: started });
    controller.applyGlobalEvent({ type: "session.created", session: otherClientSession });

    expect(fixture.state.sessions.map((session) => session.id)).toEqual([temporaryId]);

    startRequest.resolve(started);
    await start;

    const sessionIds = fixture.state.sessions.map((session) => session.id);
    expect(sessionIds).not.toContain(temporaryId);
    expect(sessionIds.filter((id) => id === started.id)).toHaveLength(1);
    expect(sessionIds.filter((id) => id === otherClientSession.id)).toHaveLength(1);
  });

  it("preserves temporary start rows across session-list refreshes before backend resolution", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api = {
      startSession: () => startRequest.promise,
      sessions: () => Promise.resolve([oldSession]),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket: new FakeSocket() });
    const { controller } = fixture;

    const start = controller.startSession();
    const temporaryId = fixture.state.selectedSession?.id;
    await controller.refreshCurrentWorkspaceSessions();

    expect(fixture.state.sessions.map((session) => session.id)).toEqual([temporaryId, oldSession.id]);
    expect(fixture.state.selectedSession?.id).toBe(temporaryId);

    startRequest.resolve(started);
    await start;

    expect(fixture.state.sessions.map((session) => session.id)).toEqual([started.id, oldSession.id]);
    expect(fixture.state.selectedSession?.id).toBe(started.id);
  });

  it("tracks multiple pending session starts without blocking another start", async () => {
    const firstStarted: SessionInfo = { ...oldSession, id: "started-session-1", path: "/tmp/started-session-1.jsonl" };
    const secondStarted: SessionInfo = { ...oldSession, id: "started-session-2", path: "/tmp/started-session-2.jsonl" };
    const startResolvers: ((session: SessionInfo) => void)[] = [];
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api = {
      startSession: () => new Promise<SessionInfo>((resolve) => { startResolvers.push(resolve); }),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket: new FakeSocket() });
    const { controller } = fixture;

    const firstStart = controller.startSession();
    const firstTemporaryId = fixture.state.selectedSession?.id;
    const secondStart = controller.startSession();
    const secondTemporaryId = fixture.state.selectedSession?.id;

    expect(startResolvers).toHaveLength(2);
    expect(fixture.state.startingSessionCount).toBe(0);
    expect(fixture.state.sessions.map((session) => session.id)).toEqual([secondTemporaryId, firstTemporaryId]);
    expect(fixture.state.selectedSession?.id).toBe(secondTemporaryId);
    expect(fixture.state.sessions.every((session) => session.persisted === false)).toBe(true);

    startResolvers[0]?.(firstStarted);
    await firstStart;

    expect(fixture.state.sessions.map((session) => session.id)).toEqual([secondTemporaryId, "started-session-1"]);
    expect(fixture.state.selectedSession?.id).toBe(secondTemporaryId);

    startResolvers[1]?.(secondStarted);
    await secondStart;

    expect(fixture.state.startingSessionCount).toBe(0);
    expect(fixture.state.sessions.map((session) => session.id)).toEqual(["started-session-2", "started-session-1"]);
    expect(fixture.state.selectedSession?.id).toBe("started-session-2");
  });

  it("moves a temporary session draft and cached-new marker to the resolved session", async () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api = {
      startSession: () => startRequest.promise,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket: new FakeSocket() });
    const { controller } = fixture;

    const start = controller.startSession();
    const temporaryId = fixture.state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected temporary session id");
    saveDraft(sessionKey(temporaryId), "draft text");

    startRequest.resolve(started);
    await start;

    expect(loadDraft(sessionKey(temporaryId))).toBe("");
    expect(loadDraft(sessionKey(started.id))).toBe("draft text");
    expect(loadCachedNewSessions().map((session) => session.id)).toEqual([started.id]);
    expect(isCachedNewSessionInfo(fixture.state.sessions[0])).toBe(true);
  });

  it("keeps a failed temporary start selected with a discardable transient row", async () => {
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api = {
      startSession: () => Promise.reject(new Error("backend unavailable")),
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket: new FakeSocket() });
    const { controller } = fixture;

    await controller.startSession();
    const temporaryId = fixture.state.selectedSession?.id;

    expect(temporaryId).toMatch(/^pending-session-/);
    expect(fixture.state.sessions.map((session) => session.id)).toEqual([temporaryId]);
    expect(fixture.state.sessions[0]?.persisted).toBe(false);
    expect(fixture.state.activity).toMatchObject({ sessionId: temporaryId, phase: "error", label: "会话创建失败" });
    expect(Object.values(fixture.state.browserErrors).map((error) => error.message).join("\n")).toContain("backend unavailable");

    await controller.deleteCachedNewSession(fixture.state.sessions[0]);

    expect(fixture.state.sessions).toEqual([]);
    expect(fixture.state.selectedSession).toBeUndefined();
  });

  it("stops the backend session if a discarded pending start resolves later", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const stoppedIds: string[] = [];
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api = {
      startSession: () => startRequest.promise,
      stop: (session) => { stoppedIds.push(sessionLookupId(session)); return Promise.resolve({ stopped: true }); },
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({ initialState: state, api, socket: new FakeSocket() });
    const { controller } = fixture;

    const start = controller.startSession();
    const temporaryId = fixture.state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected temporary session id");
    await controller.send("queued before discard");
    expect(fixture.state.clientQueuedSessionMessages[temporaryId]).toEqual([{ kind: "followUp", text: "queued before discard" }]);

    await controller.deleteCachedNewSession(fixture.state.selectedSession);
    expect(fixture.state.sessions).toEqual([]);
    expect(fixture.state.selectedSession).toBeUndefined();
    expect(fixture.state.clientQueuedSessionMessages[temporaryId]).toBeUndefined();

    startRequest.resolve(started);
    await start;

    expect(stoppedIds).toEqual([started.id]);
    expect(fixture.state.sessions).toEqual([]);
    expect(fixture.state.selectedSession).toBeUndefined();
  });
});

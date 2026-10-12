import { browserErrorScopeKey, visibleBrowserErrors, workspaceBrowserErrorScope } from "../browserErrors";
import type { NavigationFreshness } from "./types";
import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { isCachedNewSessionInfo, loadCachedNewSessions } from "../cachedNewSessions";
import { loadStagedAttachments, saveStagedAttachments, type PendingAttachment } from "../promptAttachmentStaging";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { SessionController } from "./sessionController";
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
    expect(temporarySession?.id).toMatch(/^creating:/);
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

  it("cancels before backend creation when the post-insertion callback loses navigation ownership", async () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    let apiStartCalls = 0;
    const api = {
      startSession: () => { apiStartCalls += 1; return Promise.resolve(oldSession); },
    } satisfies Partial<typeof defaultApi>;
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace, sessions: [] },
      api,
    });
    let temporaryId: string | undefined;

    await fixture.controller.startSession(() => {
      const pending = fixture.state.selectedSession;
      if (pending === undefined) throw new Error("Expected the temporary session to be selected before the callback");
      temporaryId = pending.id;
      expect(pending.id).toMatch(/^creating:/);
      expect(fixture.state.sessions.map((session) => session.id)).toEqual([pending.id]);
      expect(apiStartCalls).toBe(0);
      saveDraft(sessionKey(pending.id), "unsent draft");
      saveStagedAttachments(sessionKey(pending.id), [{ id: "attachment-1", kind: "file", name: "notes.txt", mimeType: "text/plain", data: "aGVsbG8=", size: 5 }]);
      return Promise.resolve(false);
    });

    if (temporaryId === undefined) throw new Error("Expected a temporary session id");
    expect(apiStartCalls).toBe(0);
    expect(fixture.state.sessions).toEqual([]);
    expect(fixture.state.selectedSession).toBeUndefined();
    expect(loadDraft(sessionKey(temporaryId))).toBe("");
    expect(loadStagedAttachments(sessionKey(temporaryId))).toEqual([]);
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
    const attachment: PendingAttachment = { id: "attachment-1", kind: "file", name: "notes.txt", mimeType: "text/plain", data: "aGVsbG8=", size: 5 };
    saveStagedAttachments(sessionKey(temporaryId), [attachment]);

    startRequest.resolve(started);
    await start;

    expect(loadDraft(sessionKey(temporaryId))).toBe("");
    expect(loadDraft(sessionKey(started.id))).toBe("draft text");
    expect(loadStagedAttachments(sessionKey(temporaryId))).toEqual([]);
    expect(loadStagedAttachments(sessionKey(started.id))).toEqual([attachment]);
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

    expect(temporaryId).toMatch(/^creating:/);
    expect(fixture.state.sessions.map((session) => session.id)).toEqual([temporaryId]);
    expect(fixture.state.sessions[0]?.persisted).toBe(false);
    expect(fixture.state.activity).toMatchObject({ sessionId: temporaryId, phase: "error", label: "会话创建失败" });
    expect(Object.values(fixture.state.browserErrors).map((error) => error.message).join("\n")).toContain("backend unavailable");

    await controller.deleteCachedNewSession(fixture.state.sessions[0]);

    expect(fixture.state.sessions).toEqual([]);
    expect(fixture.state.selectedSession).toBeUndefined();
  });

  it("does not fall back to another session for an expired creation route", () => {
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession], selectedSession: oldSession };
    const { controller } = createSessionControllerTestFixture({ initialState: state });

    expect(controller.preferredSession(workspace.path, state.sessions, "creating:expired")).toBeUndefined();
  });

  it("commits the stable session only when the same creation route still owns the selection", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const committed: unknown[] = [];
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedMachine: { id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" }, sessions: [] };
    const fixture = createSessionControllerTestFixture({
      initialState: state,
      api: { startSession: () => startRequest.promise },
      dependencies: {
        isPendingSessionStartRouteCurrent: () => false,
        onPendingSessionStartCommitted: (navigation, session) => { committed.push({ navigation, session }); },
      },
    });

    const start = fixture.controller.startSession();
    const temporaryId = fixture.state.selectedSession?.id;
    startRequest.resolve(started);
    await start;

    expect(fixture.state.sessions.map((session) => session.id)).toContain(started.id);
    expect(fixture.state.selectedSession).toBeUndefined();
    expect(committed).toEqual([]);
    expect(temporaryId).toMatch(/^creating:/);
  });

  it("replaces only the session ID after a matching creation route resolves", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", cwd: "/remote/repo", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const committed: unknown[] = [];
    const remoteWorkspace = { ...workspace, id: "remote-workspace", projectId: "remote-project", path: "/remote/repo" };
    const remoteMachine = { id: "remote-1", name: "Remote", kind: "remote" as const, createdAt: "now", updatedAt: "now" };
    const fixture = createSessionControllerTestFixture({
      initialState: {
        ...initialAppState(),
        selectedMachine: remoteMachine,
        selectedProject: { id: remoteWorkspace.projectId, name: "Remote Project", path: "/remote/repo", createdAt: "now" },
        selectedWorkspace: remoteWorkspace,
        sessions: [],
      },
      api: { startSession: () => startRequest.promise },
      dependencies: {
        isPendingSessionStartRouteCurrent: () => true,
        onPendingSessionStartCommitted: (navigation, session) => { committed.push({ navigation, session }); },
      },
    });

    const start = fixture.controller.startSession();
    const temporaryId = fixture.state.selectedSession?.id;
    startRequest.resolve(started);
    await start;

    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({
      navigation: { machineId: remoteMachine.id, projectId: remoteWorkspace.projectId, workspaceId: remoteWorkspace.id, sessionId: temporaryId },
      session: { id: started.id },
    });
    expect(fixture.state.selectedSession?.id).toBe(started.id);
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


describe("SessionController upstream navigation and runtime contracts", () => {
  it("publishes the stable session id before replacing a pending rendered selection", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    let selectedAtNavigation: string | undefined;
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      {
        api: {
          ...defaultApi,
          startSession: () => startRequest.promise,
        },
        socket: new FakeSocket(),
        navigateToSession: (session) => {
          selectedAtNavigation = state.selectedSession?.id;
          state = { ...state, selectedSession: session };
          return Promise.resolve(true);
        },
      },
    );

    const start = controller.startSession({ updateUrl: false });
    const temporaryId = state.selectedSession?.id;
    expect(temporaryId).toMatch(/^creating:/);

    startRequest.resolve(started);
    await start;

    expect(selectedAtNavigation).toBe(temporaryId);
    expect(state.selectedSession?.id).toBe(started.id);
  });

  it("captures the published creation token for a replacing handoff", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    let publishedSessionId: string | undefined = oldSession.id;
    let expectedSessionId: string | undefined;
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => { publishedSessionId = state.selectedSession?.id; },
      undefined,
      {
        api: {
          ...defaultApi,
          startSession: () => startRequest.promise,
        },
        socket: new FakeSocket(),
        captureNavigation: () => ({
          machineId: "local",
          workspaceId: workspace.id,
          sessionId: publishedSessionId,
        }),
        navigateToSession: (session, options) => {
          expectedSessionId = options?.expected?.sessionId;
          expect(options?.replace).toBe(true);
          expect(options?.creationHandoff).toBe(true);
          state = { ...state, selectedSession: session };
          return Promise.resolve(true);
        },
      },
    );

    const start = controller.startSession();
    startRequest.resolve(started);
    await start;

    expect(expectedSessionId).toBe(publishedSessionId);
    expect(expectedSessionId).toMatch(/^creating:/);
    expect(state.selectedSession?.id).toBe(started.id);
  });

  it("reconciles a stable session after a view-only route change during startup", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    let route = {
      machineId: "local",
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      sessionId: oldSession.id,
      tool: "core:workspace.terminal",
      view: "chat",
    };
    const expectedRoute = { ...route };
    const navigation: NavigationFreshness = {
      generation: 1,
      scope: ["machine", "project", "workspace", "session"],
      isCurrent: () => route.machineId === expectedRoute.machineId
        && route.projectId === expectedRoute.projectId
        && route.workspaceId === expectedRoute.workspaceId
        && route.sessionId === expectedRoute.sessionId,
    };
    let expectedView: string | undefined;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      {
        api: {
          ...defaultApi,
          startSession: () => startRequest.promise,
          messages: () => Promise.resolve(emptyPage),
          status: (session) => Promise.resolve(status(sessionLookupId(session))),
        },
        socket: new FakeSocket(),
        captureNavigation: () => ({ ...route }),
        beginNavigationOperation: () => navigation,
        navigateToSession: (session, options) => {
          expectedView = options?.expected?.view;
          state = { ...state, selectedSession: session };
          return Promise.resolve(true);
        },
      },
    );

    const start = controller.startSession({ updateUrl: false });
    route = { ...route, view: "workspace" };
    startRequest.resolve(started);
    await start;

    expect(expectedView).toBe("workspace");
    expect(state.sessions.map((session) => session.id)).toEqual([started.id, oldSession.id]);
    expect(state.selectedSession?.id).toBe(started.id);
  });

  it("does not strand a temporary selection when stable navigation is rejected", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      {
        api: {
          ...defaultApi,
          startSession: () => startRequest.promise,
          messages: () => Promise.resolve(emptyPage),
          status: (session) => Promise.resolve(status(sessionLookupId(session))),
        },
        socket: new FakeSocket(),
        navigateToSession: () => Promise.resolve(false),
      },
    );

    const start = controller.startSession({ updateUrl: false });
    startRequest.resolve(started);
    await start;

    expect(state.sessions.map((session) => session.id)).toEqual([started.id]);
    expect(state.selectedSession).toBeUndefined();
    expect(state.activity).toBeUndefined();
    expect(state.error).toBe("");
    const scope = workspaceBrowserErrorScope("local", workspace.projectId, workspace.id);
    expect(state.browserErrors[browserErrorScopeKey(scope)]?.message).toContain("导航已改变");
  });

  it("leaves a stale completed pending selection unselected without losing its queued send", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const promptCalls: string[] = [];
    const route: { sessionId?: string } = {};
    const expectedRouteSessionId = route.sessionId;
    const navigation: NavigationFreshness = {
      generation: 1,
      scope: ["machine", "project", "workspace", "session"],
      isCurrent: () => route.sessionId === expectedRouteSessionId,
    };
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    let navigationCalls = 0;
    const navigateToSession = (): Promise<boolean> => {
      navigationCalls += 1;
      return Promise.resolve(false);
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      {
        api: {
          ...defaultApi,
          startSession: () => startRequest.promise,
          messages: () => Promise.resolve(emptyPage),
          status: (session) => Promise.resolve(status(sessionLookupId(session))),
          prompt: (_session, text) => { promptCalls.push(text); return Promise.resolve({ accepted: true }); },
        },
        socket: new FakeSocket(),
        captureNavigation: () => ({ machineId: "local", projectId: workspace.projectId, workspaceId: workspace.id, sessionId: route.sessionId }),
        beginNavigationOperation: () => navigation,
        navigateToSession,
      },
    );

    const start = controller.startSession({ updateUrl: false });
    const temporaryId = state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected temporary session id");
    await controller.send("recover after navigation");

    route.sessionId = "newer-session";
    startRequest.resolve(started);
    await start;

    expect(navigationCalls).toBe(0);
    expect(state.sessions.map((session) => session.id)).toEqual([started.id]);
    expect(state.selectedSession).toBeUndefined();
    expect(state.activity).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(promptCalls).toEqual(["recover after navigation"]);
    expect(state.clientQueuedSessionMessages[temporaryId]).toBeUndefined();
  });

  it("keeps overlapping pending completions in list order when the newer start resolves first", async () => {
    const firstStarted: SessionInfo = { ...oldSession, id: "started-session-1", path: "/tmp/started-session-1.jsonl" };
    const secondStarted: SessionInfo = { ...oldSession, id: "started-session-2", path: "/tmp/started-session-2.jsonl" };
    const startRequests: ReturnType<typeof deferred<SessionInfo>>[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const navigation: NavigationFreshness = {
      generation: 1,
      scope: ["machine", "project", "workspace", "session"],
      isCurrent: () => true,
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      {
        api: {
          ...defaultApi,
          startSession: () => {
            const request = deferred<SessionInfo>();
            startRequests.push(request);
            return request.promise;
          },
          messages: () => Promise.resolve(emptyPage),
          status: (session) => Promise.resolve(status(sessionLookupId(session))),
        },
        socket: new FakeSocket(),
        beginNavigationOperation: () => navigation,
        navigateToSession: (session) => {
          state = { ...state, selectedSession: session };
          return Promise.resolve(true);
        },
      },
    );

    const firstStart = controller.startSession();
    const firstTemporaryId = state.selectedSession?.id;
    const secondStart = controller.startSession();
    const secondTemporaryId = state.selectedSession?.id;
    if (firstTemporaryId === undefined || secondTemporaryId === undefined) throw new Error("Expected two pending sessions");

    startRequests[1]?.resolve(secondStarted);
    await secondStart;
    startRequests[0]?.resolve(firstStarted);
    await firstStart;

    expect(state.sessions.map((session) => session.id)).toEqual([secondStarted.id, firstStarted.id]);
    expect(state.selectedSession?.id).toBe(secondStarted.id);
    expect(state.sessions.some((session) => session.id === firstTemporaryId || session.id === secondTemporaryId)).toBe(false);
  });

  it("retains a late pending-start failure under its originating workspace", async () => {
    const otherWorkspace = { ...workspace, id: "workspace-2", projectId: "project-2", path: "/other-repo", label: "other-repo" };
    const startRequest = deferred<SessionInfo>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const start = controller.startSession();
    const temporaryId = state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected a temporary session id");

    // Workspace navigation resets the visible session list while the create is
    // still pending. The rejection must remain attributable to workspace-1.
    state = { ...state, selectedWorkspace: otherWorkspace, sessions: [], selectedSession: undefined };
    startRequest.reject(new Error("late backend failure"));
    await start;

    const originScope = workspaceBrowserErrorScope("local", workspace.projectId, workspace.id);
    expect(state.browserErrors[browserErrorScopeKey(originScope)]?.message).toBe("启动会话失败：late backend failure");
    expect(visibleBrowserErrors(state.browserErrors, {
      machineId: "local",
      projectId: otherWorkspace.projectId,
      workspaceId: otherWorkspace.id,
    })).toEqual([]);
    expect(visibleBrowserErrors(state.browserErrors, {
      machineId: "local",
      projectId: workspace.projectId,
      workspaceId: workspace.id,
    })).toEqual([{ scope: originScope, message: "启动会话失败：late backend failure" }]);
    expect(state.sessions).toEqual([]);
    expect(temporaryId).toMatch(/^creating:/);
  });
});

import { browserErrorScopeKey, sessionBrowserErrorScope } from "../browserErrors";
import type { NavigationFreshness } from "./types";
import { deferred } from "./sessionController.testSupport";
import { describe, expect, it, vi } from "vitest";
import { PI_WEB_CAPABILITIES } from "../../../shared/capabilities";
import { initialAppState } from "../appState";
import { ChatTranscriptStore } from "../chatTranscriptStore";
import { SessionController } from "./sessionController";
import { InMemorySessionSelectionMemory } from "./sessionSelection";
import { createSessionControllerTestFixture, defaultApi, emptyPage, FakeSocket, oldSession, sessionKey, sessionLookupId, status, workspace, type AppState, type MessagePage } from "./sessionController.testSupport";

describe("SessionController reload and selection", () => {
  it("keeps a delayed reload completion on its originating machine", async () => {
    const persistedSession = { ...oldSession, persisted: true };
    const reload = deferred<{ reloaded: true }>();
    const cachedPages = new Map<string, MessagePage>([
      [sessionKey(oldSession.id), emptyPage],
      [`remote:${oldSession.id}`, emptyPage],
    ]);
    const messages = vi.fn(() => Promise.resolve(emptyPage));
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace, selectedSession: persistedSession, sessions: [persistedSession] },
      api: { reloadSession: () => reload.promise, messages, status: () => Promise.resolve(status(oldSession.id)), streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }) },
      dependencies: { transcripts: new ChatTranscriptStore({
        read: (key) => cachedPages.get(key),
        write: (key, page) => { cachedPages.set(key, page); },
        remove: (key) => { cachedPages.delete(key); },
      }) },
    });
    try {
      const reloading = fixture.controller.reloadSession();
      fixture.replaceState({ ...fixture.state, selectedMachine: { id: "remote", name: "Remote", kind: "remote", createdAt: "now", updatedAt: "now" } });
      reload.resolve({ reloaded: true });
      await reloading;

      expect(messages).not.toHaveBeenCalled();
      expect(cachedPages.has(sessionKey(oldSession.id))).toBe(false);
      expect(cachedPages.get(`remote:${oldSession.id}`)).toEqual(emptyPage);
    } finally {
      fixture.controller.dispose();
    }
  });

  it("reloads the selected session from disk, discards the cached transcript, and re-fetches history", async () => {
    const persistedSession = { ...oldSession, persisted: true };
    const cacheKey = sessionKey(oldSession.id);
    const freshPage: MessagePage = { messages: [{ role: "assistant", content: "fresh from disk" }], start: 1, total: 2 };
    const cachedPages = new Map<string, MessagePage>([[cacheKey, { messages: [{ role: "user", content: "stale cached transcript" }], start: 0, total: 2 }]]);
    const reloadCalls: string[] = [];
    const messageCalls: string[] = [];
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: persistedSession,
      sessions: [persistedSession],
      machineRuntimes: { local: { machineId: "local", ok: true, checkedAt: "now", capabilities: [PI_WEB_CAPABILITIES.sessionsReload] } },
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      reloadSession: (session) => {
        reloadCalls.push(sessionLookupId(session));
        return Promise.resolve({ reloaded: true });
      },
      messages: (session) => {
        messageCalls.push(sessionLookupId(session));
        return Promise.resolve(freshPage);
      },
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      {
        api,
        socket: new FakeSocket(),
        transcripts: new ChatTranscriptStore({
          read: (sessionId) => cachedPages.get(sessionId),
          write: (sessionId, page) => { cachedPages.set(sessionId, page); },
          remove: (sessionId) => { cachedPages.delete(sessionId); },
        }),
      },
    );

    await controller.reloadSession(persistedSession);

    expect(reloadCalls).toEqual([oldSession.id]);
    expect(messageCalls).toEqual([oldSession.id]);
    expect(cachedPages.get(cacheKey)).toEqual(freshPage);
    expect(state.messages).toEqual([{ role: "assistant", parts: [{ type: "text", text: "fresh from disk" }], transcriptIndex: 1 }]);
    expect(state.messagePageStart).toBe(1);
    expect(state.error).toBe("");
  });

  it("reloads sessions from disk without capability metadata", async () => {
    const persistedSession = { ...oldSession, persisted: true };
    const reloadCalls: string[] = [];
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: persistedSession,
      sessions: [persistedSession],
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      reloadSession: (session) => {
        reloadCalls.push(sessionLookupId(session));
        return Promise.resolve({ reloaded: true });
      },
      messages: () => Promise.resolve({ messages: [], start: 0, total: 0 }),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      { api, socket: new FakeSocket() },
    );

    await controller.reloadSession(persistedSession);

    expect(reloadCalls).toEqual([persistedSession.id]);
    expect(state.error).toBe("");
  });

  it("does not reload sessions from disk without a persisted server signal when persistence is authoritative", async () => {
    const reloadCalls: string[] = [];
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      machineRuntimes: { local: { machineId: "local", ok: true, checkedAt: "now", capabilities: [PI_WEB_CAPABILITIES.sessionsReload, PI_WEB_CAPABILITIES.sessionsPersistedState] } },
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      reloadSession: (session) => {
        reloadCalls.push(sessionLookupId(session));
        return Promise.resolve({ reloaded: true });
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      { api, socket: new FakeSocket() },
    );

    await controller.reloadSession(oldSession);
    await controller.reloadSession({ ...oldSession, persisted: false });

    expect(reloadCalls).toEqual([]);
    expect(state.error).toBe("");
  });

  it("forgets archived selections when the archived section collapse clears selection", async () => {
    const archivedSession = { ...oldSession, archived: true, archivedAt: "later" };
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [archivedSession] };
    const urlUpdates: ({ replace?: boolean | undefined } | undefined)[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      (options) => { urlUpdates.push(options); },
      new InMemorySessionSelectionMemory(),
      { api, socket: new FakeSocket() },
    );

    await controller.selectSession(archivedSession, { updateUrl: false });
    expect(controller.preferredSession(workspace.path, state.sessions, undefined)).toBe(archivedSession);

    await controller.clearSelectionAfterArchivedCollapse();

    expect(state.selectedSession).toBeUndefined();
    expect(controller.preferredSession(workspace.path, state.sessions, undefined)).toBeUndefined();
    expect(urlUpdates).toEqual([undefined]);
  });
});


describe("SessionController upstream navigation and runtime contracts", () => {
  it("reconciles a restored selected session after a view-only navigation change", async () => {
    const archivedSession = { ...oldSession, archived: true, archivedAt: "later" };
    const restoreRequest = deferred<{ restored: true }>();
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: archivedSession,
      sessions: [archivedSession],
      mainView: "chat",
    };
    let currentView: string | undefined = "chat";
    let navigationCalls = 0;
    const navigation: NavigationFreshness = {
      generation: 1,
      scope: ["machine", "project", "workspace", "session"],
      isCurrent: () => true,
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      restore: () => restoreRequest.promise,
      messages: () => Promise.resolve(emptyPage),
      status: () => Promise.resolve(status(archivedSession.id)),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      {
        api,
        socket: new FakeSocket(),
        beginNavigationOperation: () => navigation,
        navigateToSession: () => {
          navigationCalls += 1;
          return Promise.resolve(false);
        },
        captureNavigation: () => ({
          machineId: "local",
          projectId: workspace.projectId,
          workspaceId: workspace.id,
          sessionId: archivedSession.id,
          view: currentView,
        }),
      },
    );

    const restoring = controller.restoreSession(archivedSession);
    currentView = "workspace";
    state = { ...state, mainView: "workspace" };
    restoreRequest.resolve({ restored: true });
    await restoring;

    expect(state.selectedSession?.archived).toBeUndefined();
    expect(state.sessions[0]?.archived).toBeUndefined();
    expect(state.mainView).toBe("workspace");
    expect(state.error).toBe("");
    expect(navigationCalls).toBe(0);
  });

  it("does not apply a restore completion after the selected route changes", async () => {
    const archivedSession = { ...oldSession, archived: true, archivedAt: "later" };
    const nextSession = { ...oldSession, id: "next-session", path: "/tmp/next-session.jsonl" };
    const restoreRequest = deferred<{ restored: true }>();
    let navigationCurrent = true;
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: archivedSession,
      sessions: [archivedSession],
    };
    const navigation: NavigationFreshness = {
      generation: 1,
      scope: ["machine", "project", "workspace", "session"],
      isCurrent: () => navigationCurrent,
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      {
        api: { ...defaultApi, restore: () => restoreRequest.promise },
        socket: new FakeSocket(),
        beginNavigationOperation: () => navigation,
      },
    );

    const restoring = controller.restoreSession(archivedSession);
    state = { ...state, selectedSession: nextSession, sessions: [nextSession] };
    navigationCurrent = false;
    restoreRequest.resolve({ restored: true });
    await restoring;

    expect(state.selectedSession?.id).toBe(nextSession.id);
    expect(state.sessions).toEqual([nextSession]);
    expect(state.error).toBe("");
  });

  it("retains a stale restore failure under its originating session scope", async () => {
    const archivedSession = { ...oldSession, archived: true, archivedAt: "later" };
    const nextSession = { ...oldSession, id: "next-session", path: "/tmp/next-session.jsonl" };
    const restoreRequest = deferred<{ restored: true }>();
    let navigationCurrent = true;
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: archivedSession,
      sessions: [archivedSession],
    };
    const navigation: NavigationFreshness = {
      generation: 1,
      scope: ["machine", "project", "workspace", "session"],
      isCurrent: () => navigationCurrent,
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      {
        api: { ...defaultApi, restore: () => restoreRequest.promise },
        socket: new FakeSocket(),
        beginNavigationOperation: () => navigation,
      },
    );

    const restoring = controller.restoreSession(archivedSession);
    state = { ...state, selectedSession: nextSession, sessions: [nextSession] };
    navigationCurrent = false;
    restoreRequest.reject(new Error("origin restore unavailable"));
    await restoring;

    const scope = sessionBrowserErrorScope("local", archivedSession.id, {
      cwd: archivedSession.cwd,
      projectId: workspace.projectId,
      workspaceId: workspace.id,
    });
    expect(state.browserErrors[browserErrorScopeKey(scope)]?.message).toBe("origin restore unavailable");
    expect(state.selectedSession).toBe(nextSession);
    expect(state.sessions).toEqual([nextSession]);
  });

  it("does not reload sessions from disk without a persisted server signal", async () => {
    const reloadCalls: string[] = [];
    let state: AppState = {
      ...initialAppState(),
      machineRuntimes: { local: { machineId: "local", ok: true, checkedAt: "now" } },
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      reloadSession: (session) => {
        reloadCalls.push(sessionLookupId(session));
        return Promise.resolve({ reloaded: true });
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      { api, socket: new FakeSocket() },
    );

    await controller.reloadSession(oldSession);
    await controller.reloadSession({ ...oldSession, persisted: false });

    expect(reloadCalls).toEqual([]);
    expect(state.error).toBe("");
  });

  it("routes archived-section collapse through the navigation boundary", async () => {
    const archivedSession = { ...oldSession, archived: true, archivedAt: "later" };
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [archivedSession], selectedSession: archivedSession };
    const selectedAtNavigation: string[] = [];
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      {
        api: { ...defaultApi, messages: () => Promise.resolve(emptyPage) },
        socket: new FakeSocket(),
        navigateToSession: (session, options) => {
          selectedAtNavigation.push(`${state.selectedSession?.id ?? "none"}:${options?.expected?.sessionId ?? "none"}`);
          state = { ...state, selectedSession: session };
          return Promise.resolve(true);
        },
      },
    );

    await controller.clearSelectionAfterArchivedCollapse();

    expect(selectedAtNavigation).toEqual([`${archivedSession.id}:${archivedSession.id}`]);
    expect(state.selectedSession).toBeUndefined();
  });
});

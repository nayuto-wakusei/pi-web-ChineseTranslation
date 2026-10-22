import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import type { SessionInfo, SessionTranscriptSnapshot } from "../api";
import { ChatTranscriptStore } from "../chatTranscriptStore";
import { SessionController, type SessionControllerDependencies, type SessionEventSocket } from "./sessionController";
import { createSessionControllerTestFixture, defaultApi, deferred, emptyPage, EmitSocket, oldSession, replacementSession, status, workspace, type AppState, type MessagePage, type SessionStatus, type SessionStreamSnapshot } from "./sessionController.testSupport";

function page(text: string, total: number): MessagePage {
  return { messages: [{ role: "assistant", content: text }], start: 0, total };
}

describe("SessionController first coherent snapshot ownership", () => {
  it("does not make a slow or rejecting notification inbox own transcript readiness", async () => {
    const inbox = deferred<undefined>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ready = vi.fn();
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] },
      api: {
        transcriptSnapshot: () => Promise.resolve({ page: emptyPage, status: status(oldSession.id), seq: 0, partial: null }),
        thinkingLevels: () => Promise.resolve({ levels: [] }),
      },
      dependencies: {
        onSelectedSessionReady: ready,
        notifications: {
          prepareSelectedSession: vi.fn(), clearSelectedSession: vi.fn(), refreshSelectedSession: () => inbox.promise,
          applyInboxEvent: vi.fn(), shouldFilterLegacyNotification: () => false,
        },
      },
    });
    try {
      await fixture.controller.selectSession(oldSession);
      expect(ready).toHaveBeenCalledOnce();
      inbox.reject(new Error("private-notification-token"));
      await vi.waitFor(() => { expect(warn).toHaveBeenCalledOnce(); });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("private-notification-token");
      expect(Object.values(fixture.state.browserErrors)).toEqual([]);
      expect(ready).toHaveBeenCalledOnce();
    } finally { fixture.controller.dispose(); warn.mockRestore(); }
  });

  it("captures observation before reading and ignores a same-ID response for a changed transcript identity", async () => {
    const pending = deferred<SessionTranscriptSnapshot>();
    const observer = vi.fn();
    const capture = vi.fn(() => observer);
    const ready = vi.fn();
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace },
      api: { transcriptSnapshot: () => pending.promise, thinkingLevels: () => Promise.resolve({ levels: [] }) },
      dependencies: { observeSessionSnapshot: capture, onSelectedSessionReady: ready },
    });
    const selecting = fixture.controller.selectSession(oldSession);
    await vi.waitFor(() => { expect(capture).toHaveBeenCalledExactlyOnceWith("local", oldSession.id); });
    const changed = { ...oldSession, path: "/tmp/different-transcript.jsonl", cwd: "/other-workspace" };
    fixture.replaceState({ ...fixture.state, selectedSession: changed });
    pending.resolve({ page: page("stale", 1), status: status(oldSession.id), seq: 0, partial: null });
    await selecting;
    expect(fixture.state.selectedSession).toEqual(changed);
    expect(fixture.state.messages).toEqual([]);
    expect(observer).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    fixture.controller.dispose();
  });

  it("does not refresh the old notification owner when its socket opens after a same-ID path change", async () => {
    let initialOpen: (() => void) | undefined;
    const socket: SessionEventSocket = {
      connect(_session, _onEvent, _onReconnect, _machineId, onInitialOpen) { initialOpen = onInitialOpen; },
      setHandler: vi.fn(), close: vi.fn(),
    };
    const refresh = vi.fn(() => Promise.resolve());
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace }, socket,
      api: {
        transcriptSnapshot: () => Promise.resolve({ page: emptyPage, status: status(oldSession.id), seq: 0, partial: null }),
        thinkingLevels: () => Promise.resolve({ levels: [] }),
      },
      dependencies: { notifications: {
        prepareSelectedSession: vi.fn(), clearSelectedSession: vi.fn(), refreshSelectedSession: refresh,
        applyInboxEvent: vi.fn(), shouldFilterLegacyNotification: () => false,
      } },
    });
    await fixture.controller.selectSession(oldSession);
    expect(refresh).toHaveBeenCalledOnce();
    fixture.replaceState({ ...fixture.state, selectedSession: { ...oldSession, path: "/tmp/other-session.jsonl" } });
    initialOpen?.();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    fixture.controller.dispose();
  });

  it("publishes only the accepted authoritative status after its branch and range are applied", async () => {
    const transcripts = new ChatTranscriptStore({ read: () => undefined, write: () => undefined, remove: () => undefined });
    const accepted = status(oldSession.id);
    const observer = vi.fn(() => { expect(fixture.state.messagePageLeafId).toBe("selected-leaf"); });
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace },
      api: {
        transcriptSnapshot: () => Promise.resolve({ page: { ...page("branch", 1), leafId: "selected-leaf" }, status: accepted, seq: 0, partial: null }),
        thinkingLevels: () => Promise.resolve({ levels: [] }),
      },
      dependencies: { transcripts, observeSessionSnapshot: () => observer },
    });
    await fixture.controller.selectSession(oldSession);
    expect(observer).toHaveBeenCalledExactlyOnceWith(accepted);
    expect(fixture.state.messagePageEnd).toBe(1);
    fixture.controller.dispose();
  });

  it.each(["resolve", "reject"] as const)("completes the initial join after coherent replay without waiting for later refresh work (%s)", async (outcome) => {
    const initial = deferred<SessionStreamSnapshot & { page: MessagePage; status: SessionStatus }>();
    const trailing = deferred<SessionStreamSnapshot & { page: MessagePage; status: SessionStatus }>();
    const socket = new EmitSocket();
    const ready = vi.fn();
    const updateUrl = vi.fn();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const transcriptSnapshot = vi.fn<typeof defaultApi.transcriptSnapshot>()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(trailing.promise);
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, updateUrl, undefined, {
      api: { ...defaultApi, transcriptSnapshot, thinkingLevels: () => Promise.resolve({ levels: [] }) },
      socket,
      onSelectedSessionReady: ready,
    });
    let selected = false;
    let refreshed = false;
    const selecting = controller.selectSession(oldSession).then(() => { selected = true; });
    await vi.waitFor(() => { expect(transcriptSnapshot).toHaveBeenCalledOnce(); });
    const refreshing = controller.refreshSelectedSession().then(() => { refreshed = true; });
    socket.emit({ type: "message.append", message: { role: "user", content: "replayed" }, seq: 6 });
    initial.resolve({ page: page("snapshot", 1), status: status(oldSession.id), seq: 5, partial: null });
    try {
      await vi.waitFor(() => { expect(selected).toBe(true); });
      expect(transcriptSnapshot).toHaveBeenCalledTimes(2);
      expect(refreshed).toBe(false);
      expect(ready).toHaveBeenCalledOnce();
      expect(updateUrl).toHaveBeenCalledOnce();
      expect(state.messages.map((message) => message.parts)).toEqual([
        [{ type: "text", text: "snapshot" }], [{ type: "text", text: "replayed" }],
      ]);
      if (outcome === "reject") trailing.reject(new Error("later refresh failed"));
      else trailing.resolve({ page: page("later", 2), status: status(oldSession.id), seq: 7, partial: null });
      await refreshing;
      expect(ready).toHaveBeenCalledOnce();
      if (outcome === "reject") expect(Object.values(state.browserErrors).map((error) => error.message)).toContain("later refresh failed");
    } finally {
      trailing.resolve({ page: emptyPage, status: status(oldSession.id), seq: 7, partial: null });
      await Promise.all([selecting, refreshing]);
      controller.dispose();
    }
  });

  it("waits for a replacement snapshot when buffered replay invalidates the initial branch", async () => {
    const initial = deferred<SessionStreamSnapshot & { page: MessagePage; status: SessionStatus }>();
    const replacement = deferred<SessionStreamSnapshot & { page: MessagePage; status: SessionStatus }>();
    const socket = new EmitSocket();
    const ready = vi.fn();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const transcriptSnapshot = vi.fn<typeof defaultApi.transcriptSnapshot>()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(replacement.promise);
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, {
      api: { ...defaultApi, transcriptSnapshot, thinkingLevels: () => Promise.resolve({ levels: [] }) }, socket, onSelectedSessionReady: ready,
    });
    let selected = false;
    const selecting = controller.selectSession(oldSession, { updateUrl: false }).then(() => { selected = true; });
    try {
      await vi.waitFor(() => { expect(transcriptSnapshot).toHaveBeenCalledOnce(); });
      socket.emit({ type: "session.tree.changed", seq: 6 });
      initial.resolve({ page: page("invalid branch", 1), status: status(oldSession.id), seq: 5, partial: null });
      await vi.waitFor(() => { expect(transcriptSnapshot).toHaveBeenCalledTimes(2); });
      expect(selected).toBe(false);
      expect(ready).not.toHaveBeenCalled();
      replacement.resolve({ page: page("current branch", 1), status: status(oldSession.id), seq: 6, partial: null });
      await selecting;
      expect(ready).toHaveBeenCalledOnce();
      expect(state.messages[0]?.parts).toEqual([{ type: "text", text: "current branch" }]);
    } finally {
      replacement.resolve({ page: emptyPage, status: status(oldSession.id), seq: 6, partial: null });
      await selecting;
      controller.dispose();
    }
  });


});

describe("SessionController automatic navigation candidates", () => {
  const parent: SessionInfo = { ...oldSession, persisted: true, messageCount: 1 };
  const hidden: SessionInfo = { ...replacementSession, id: "collapsed-agent", messageCount: 1, persisted: true };
  const visible: SessionInfo = { ...replacementSession, id: "visible-session", messageCount: 1, persisted: true };
  const candidates = (sessions: SessionInfo[]) => sessions.filter((session) => session.id !== hidden.id);

  it("filters automatic restores but never filters an explicit target ID", () => {
    const fixture = createSessionControllerTestFixture({ dependencies: { automaticSessionCandidates: candidates } });
    expect(fixture.controller.preferredSession(workspace.path, [hidden, visible], undefined)).toBe(visible);
    expect(fixture.controller.preferredSession(workspace.path, [hidden, visible], "")).toBe(visible);
    expect(fixture.controller.preferredSession(workspace.path, [hidden, visible], hidden.id)).toBe(hidden);
    fixture.controller.dispose();
  });

  it("skips collapsed agents when selecting an automatic archive successor", async () => {
    const navigate = vi.fn<NonNullable<SessionControllerDependencies["navigateToSession"]>>(() => Promise.resolve(true));
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace, sessions: [parent, hidden, visible], selectedSession: parent },
      api: { archive: () => Promise.resolve({ archived: true }) },
      dependencies: { automaticSessionCandidates: candidates, navigateToSession: navigate },
    });
    await fixture.controller.archiveSession(parent);
    expect(navigate.mock.calls[0]?.[0]).toEqual(visible);
    expect(fixture.state.sessions.map((session) => session.id)).toEqual([parent.id, hidden.id, visible.id]);
    fixture.controller.dispose();
  });

  it("skips collapsed agents only when the selected row disappears during a list refresh", async () => {
    const navigate = vi.fn<NonNullable<SessionControllerDependencies["navigateToSession"]>>(() => Promise.resolve(true));
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace, sessions: [parent, hidden, visible], selectedSession: parent },
      api: { sessions: () => Promise.resolve([hidden, visible]), pinned: () => Promise.resolve({ sessionIds: [] }) },
      dependencies: { automaticSessionCandidates: candidates, navigateToSession: navigate },
    });
    await fixture.controller.refreshCurrentWorkspaceSessions();
    expect(navigate.mock.calls[0]?.[0]).toEqual(visible);
    navigate.mockClear();
    fixture.replaceState({ ...fixture.state, selectedSession: hidden });
    await fixture.controller.refreshCurrentWorkspaceSessions();
    expect(fixture.state.selectedSession).toEqual(hidden);
    expect(navigate).not.toHaveBeenCalled();
    fixture.controller.dispose();
  });
});

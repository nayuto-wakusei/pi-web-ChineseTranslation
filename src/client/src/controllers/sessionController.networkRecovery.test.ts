import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkRequestError, HttpRequestError } from "../api/http";
import { initialAppState } from "../appState";
import { setClientTranslations } from "../i18n";
import { BrowserErrorReporter, sessionBrowserErrorScope, workspaceBrowserErrorScope } from "../browserErrors";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, EmitSocket, emptyPage, FakeSocket, oldSession, replacementSession, status, transcriptSnapshotFixture, workspace, type AppState, type SessionInfo } from "./sessionController.testSupport";

const sessionScope = sessionBrowserErrorScope("local", oldSession.id, { cwd: oldSession.cwd, projectId: workspace.projectId, workspaceId: workspace.id });
const workspaceScope = workspaceBrowserErrorScope("local", workspace.projectId, workspace.id);
const networkFailure = () => new NetworkRequestError("Load failed", { cause: new TypeError("Load failed") });

function setup(overrides: Partial<typeof defaultApi> = {}) {
  let state: AppState = {
    ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession],
    messages: [{ role: "assistant", parts: [{ type: "text", text: "cached conversation" }] }],
  };
  const snapshot = vi.fn<typeof defaultApi.transcriptSnapshot>(() => transcriptSnapshotFixture(emptyPage, status(oldSession.id)));
  const sessions = vi.fn<typeof defaultApi.sessions>(() => Promise.resolve([oldSession]));
  const api = { ...defaultApi, transcriptSnapshot: snapshot, sessions, pinned: () => Promise.resolve({ sessionIds: [] }), thinkingLevels: () => Promise.resolve({ levels: [] }), ...overrides };
  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
  const controller = new SessionController(() => state, setState, () => undefined, undefined, { api, socket: new FakeSocket() });
  return { controller, snapshot, sessions, getState: () => state, setState, errors: new BrowserErrorReporter(() => state, setState) };
}

beforeEach(() => { setClientTranslations("en", {}); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("silent session read recovery", () => {
  it("retains the current conversation without a banner while a resume fetch recovers", async () => {
    const h = setup();
    h.snapshot.mockRejectedValueOnce(networkFailure());
    const messages = h.getState().messages;
    const refresh = h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(h.snapshot).toHaveBeenCalledOnce();
    expect(h.getState().browserErrors).toEqual({});
    expect(h.getState().messages).toBe(messages);
    expect(h.getState().selectedSession).toBe(oldSession);

    await vi.advanceTimersByTimeAsync(500);
    await refresh;
    expect(h.snapshot).toHaveBeenCalledTimes(2);
    expect(h.getState().browserErrors).toEqual({});
  });

  it("offers an actionable error only after bounded recovery, and clears it on a successful poll", async () => {
    const h = setup();
    h.snapshot.mockRejectedValue(networkFailure());
    const refresh = h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.getState().browserErrors).toEqual({});
    await vi.advanceTimersByTimeAsync(3000);
    await refresh;

    expect(h.snapshot).toHaveBeenCalledTimes(4);
    expect(Object.values(h.getState().browserErrors)).toEqual([{
      scope: sessionScope,
      message: "The conversation could not be refreshed. Check your connection and retry.",
      recovery: "session-refresh",
    }]);
    h.snapshot.mockImplementation(() => transcriptSnapshotFixture(emptyPage, status(oldSession.id)));
    await h.controller.refreshSelectedSession(undefined, { silent: true });
    expect(h.getState().browserErrors).toEqual({});
  });

  it("does not retry or hide HTTP failures", async () => {
    const h = setup();
    h.snapshot.mockRejectedValue(new HttpRequestError("Session not found", 404));
    await h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
    expect(h.snapshot).toHaveBeenCalledOnce();
    expect(Object.values(h.getState().browserErrors)).toEqual([{ scope: sessionScope, message: "Session not found" }]);
  });

  it("stops recovery when the selected session changes", async () => {
    const h = setup();
    h.snapshot.mockRejectedValue(networkFailure());
    const refresh = h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);
    h.setState({ selectedSession: replacementSession });
    await vi.runAllTimersAsync();
    await refresh;
    expect(h.snapshot).toHaveBeenCalledOnce();
    expect(h.getState().selectedSession).toBe(replacementSession);
    expect(h.getState().browserErrors).toEqual({});
  });

  it("preserves an action failure reported while an older conversation read succeeds", async () => {
    const gate = deferred<Awaited<ReturnType<typeof defaultApi.transcriptSnapshot>>>();
    const h = setup({ transcriptSnapshot: () => gate.promise });
    h.errors.report(sessionScope, "old refresh failure", "session-refresh");
    const refresh = h.controller.refreshSelectedSession();
    await vi.advanceTimersByTimeAsync(0);
    h.errors.report(sessionScope, "Prompt delivery could not be confirmed");
    gate.resolve(await transcriptSnapshotFixture(emptyPage, status(oldSession.id)));
    await refresh;
    expect(Object.values(h.getState().browserErrors)).toEqual([{ scope: sessionScope, message: "Prompt delivery could not be confirmed" }]);
  });

  it("clears a retained conversation refresh error after an archived conversation loads", async () => {
    const h = setup({ messages: () => Promise.resolve(emptyPage) });
    h.errors.report(sessionScope, "Conversation refresh failed", "session-refresh");
    await h.controller.selectSession({ ...oldSession, archived: true }, { updateUrl: false });
    expect(h.getState().selectedSession?.archived).toBe(true);
    expect(h.getState().browserErrors).toEqual({});
  });

  it("never retries a failed prompt or clears its error when a background read succeeds", async () => {
    const failure = networkFailure();
    const prompt = vi.fn<typeof defaultApi.prompt>().mockRejectedValue(failure);
    const h = setup({ prompt });

    expect(await h.controller.send("hello")).toBe(false);
    await h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
    await vi.runAllTimersAsync();

    expect(prompt).toHaveBeenCalledOnce();
    expect(Object.values(h.getState().browserErrors)).toEqual([{ scope: sessionScope, message: failure.message }]);
  });

  it("uses silent network recovery on a session socket reconnect", async () => {
    const h = setup();
    const socket = new EmitSocket();
    const controller = new SessionController(h.getState, h.setState, () => undefined, undefined, {
      api: { ...defaultApi, transcriptSnapshot: h.snapshot, thinkingLevels: () => Promise.resolve({ levels: [] }) }, socket,
    });
    await controller.selectSession(oldSession, { updateUrl: false });
    h.snapshot.mockRejectedValueOnce(networkFailure());
    socket.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.getState().browserErrors).toEqual({});
    await vi.advanceTimersByTimeAsync(500);
    expect(h.snapshot).toHaveBeenCalledTimes(3);
    expect(h.getState().browserErrors).toEqual({});
    controller.dispose();
  });
});

describe("workspace session-list recovery", () => {
  it("retries transient session-list failures without disturbing the selection", async () => {
    const h = setup();
    h.sessions.mockRejectedValueOnce(networkFailure());
    const refresh = h.controller.refreshCurrentWorkspaceSessions("local", { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.getState().browserErrors).toEqual({});
    expect(h.getState().selectedSession).toBe(oldSession);
    await vi.advanceTimersByTimeAsync(500);
    await refresh;
    expect(h.sessions).toHaveBeenCalledTimes(2);
    expect(h.getState().browserErrors).toEqual({});
  });

  it("clears only a recovered session-list error, not an unrelated workspace failure", async () => {
    const h = setup();
    h.sessions.mockRejectedValue(networkFailure());
    const refresh = h.controller.refreshCurrentWorkspaceSessions("local", { recoverNetwork: true });
    await vi.runAllTimersAsync();
    await refresh;
    expect(Object.values(h.getState().browserErrors)).toEqual([{
      scope: workspaceScope,
      message: "The session list could not be refreshed. Check your connection and retry.",
      recovery: "workspace-sessions-refresh",
    }]);
    h.sessions.mockResolvedValue([oldSession]);
    await h.controller.refreshCurrentWorkspaceSessions();
    expect(h.getState().browserErrors).toEqual({});
    h.errors.report(workspaceScope, "Workspace removal failed");
    await h.controller.refreshCurrentWorkspaceSessions();
    expect(Object.values(h.getState().browserErrors)).toEqual([{ scope: workspaceScope, message: "Workspace removal failed" }]);
  });

  it("coalesces overlapping list refreshes so a late failure cannot follow successful recovery", async () => {
    const first = deferred<SessionInfo[]>();
    const h = setup();
    h.sessions.mockImplementationOnce(() => first.promise);
    const refresh = h.controller.refreshCurrentWorkspaceSessions();
    const sameTurn = h.controller.refreshCurrentWorkspaceSessions();
    await vi.advanceTimersByTimeAsync(0);
    const trailing = h.controller.refreshCurrentWorkspaceSessions();
    expect(h.sessions).toHaveBeenCalledOnce();
    first.reject(networkFailure());
    await Promise.all([refresh, sameTurn, trailing]);
    expect(h.sessions).toHaveBeenCalledTimes(2);
    expect(h.getState().browserErrors).toEqual({});
  });

  it.each(["select", "deselect"])("continues workspace-list recovery when users %s a conversation in the same workspace", async (action) => {
    const h = setup();
    h.snapshot.mockImplementation((session) => transcriptSnapshotFixture(emptyPage, status(session.id)));
    h.sessions.mockRejectedValueOnce(networkFailure()).mockResolvedValue([oldSession, replacementSession]);
    const refresh = h.controller.refreshCurrentWorkspaceSessions("local", { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);
    if (action === "select") await h.controller.selectSession(replacementSession, { updateUrl: false });
    else h.controller.deselectSession({ updateUrl: false });

    await vi.advanceTimersByTimeAsync(500);
    await refresh;

    expect(h.sessions).toHaveBeenCalledTimes(2);
    expect(h.getState().sessions).toEqual([oldSession, replacementSession]);
    expect(h.getState().selectedSession?.id).toBe(action === "select" ? replacementSession.id : undefined);
    expect(h.getState().browserErrors).toEqual({});
  });

  it.each(["select", "deselect"])("applies an in-flight session list when users %s within the same workspace", async (action) => {
    const pending = deferred<SessionInfo[]>();
    const h = setup();
    h.snapshot.mockImplementation((session) => transcriptSnapshotFixture(emptyPage, status(session.id)));
    h.sessions.mockReturnValueOnce(pending.promise);
    const refresh = h.controller.refreshCurrentWorkspaceSessions();
    await vi.advanceTimersByTimeAsync(0);
    if (action === "select") await h.controller.selectSession(replacementSession, { updateUrl: false });
    else h.controller.deselectSession({ updateUrl: false });
    const refreshed = [{ ...oldSession, name: "Refreshed list" }, replacementSession];
    pending.resolve(refreshed);
    await refresh;

    expect(h.getState().sessions).toEqual(refreshed);
    expect(h.getState().selectedSession?.id).toBe(action === "select" ? replacementSession.id : undefined);
  });

  it("does not retry a retired workspace or emit its network banner", async () => {
    const h = setup();
    h.sessions.mockRejectedValue(networkFailure());
    const refresh = h.controller.refreshCurrentWorkspaceSessions("local", { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);
    h.setState({ selectedWorkspace: { ...workspace, id: "another-workspace" } });
    await vi.runAllTimersAsync();
    await refresh;
    expect(h.sessions).toHaveBeenCalledOnce();
    expect(h.getState().browserErrors).toEqual({});
  });

  it("stops session-list retries when the controller is disposed", async () => {
    const h = setup();
    h.sessions.mockRejectedValue(networkFailure());
    const refresh = h.controller.refreshCurrentWorkspaceSessions("local", { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);
    h.controller.dispose();
    await vi.runAllTimersAsync();
    await refresh;
    expect(h.sessions).toHaveBeenCalledOnce();
    expect(h.getState().browserErrors).toEqual({});
  });
});

describe("read recovery retirement boundaries", () => {
  it("keeps background diagnostics metadata-only without exposing provider error contents", async () => {
    const h = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.snapshot.mockRejectedValue(new Error("private-provider-token and private source"));
    await h.controller.refreshSelectedSession(undefined, { silent: true });
    expect(warn).toHaveBeenCalledExactlyOnceWith("Selected session background refresh failed", { machineId: "local", sessionId: oldSession.id, errorCategory: "session-refresh" });
    expect(h.getState().browserErrors).toEqual({});
    h.controller.dispose();
  });
  it.each(["session", "workspace"] as const)("dispose clears %s backoff immediately and settles callers", async (kind) => {
    const h = setup();
    h.snapshot.mockRejectedValue(networkFailure());
    h.sessions.mockRejectedValue(networkFailure());
    const pending = kind === "session"
      ? h.controller.refreshSelectedSession(undefined, { recoverNetwork: true })
      : h.controller.refreshCurrentWorkspaceSessions("local", { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    h.controller.dispose();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    expect(h.getState().browserErrors).toEqual({});
  });

  it.each([
    { kind: "session", recoverNetwork: true }, { kind: "workspace", recoverNetwork: true },
    { kind: "session", recoverNetwork: false }, { kind: "workspace", recoverNetwork: false },
  ] as const)("retirement releases a hung $kind read (recovery=$recoverNetwork) so the same key can refresh", async ({ kind, recoverNetwork }) => {
    const h = setup();
    const oldSnapshot = deferred<Awaited<ReturnType<typeof defaultApi.transcriptSnapshot>>>();
    const oldList = deferred<SessionInfo[]>();
    h.snapshot.mockImplementationOnce(() => oldSnapshot.promise);
    h.sessions.mockImplementationOnce(() => oldList.promise);
    const refresh = (recoverNetwork = true) => kind === "session"
      ? h.controller.refreshSelectedSession(undefined, { recoverNetwork })
      : h.controller.refreshCurrentWorkspaceSessions("local", { recoverNetwork });
    const old = refresh(recoverNetwork);
    await vi.advanceTimersByTimeAsync(0);
    h.controller.retireReadRecoveries([kind]);
    const fresh = refresh();
    await Promise.all([old, fresh]);
    const accepted = h.getState();
    oldSnapshot.resolve({ ...await transcriptSnapshotFixture(emptyPage, status(oldSession.id)), page: { messages: [{ role: "user", content: "retired secret" }], start: 0, total: 1, leafId: "retired-leaf" } });
    oldList.resolve([{ ...oldSession, name: "retired list" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.getState()).toBe(accepted);
    expect(kind === "session" ? h.snapshot : h.sessions).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    h.controller.dispose();
  });

  it("session-only retirement does not cancel the same workspace's list recovery", async () => {
    const h = setup();
    h.sessions.mockRejectedValueOnce(networkFailure());
    const pending = h.controller.refreshCurrentWorkspaceSessions("local", { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);
    h.controller.retireReadRecoveries(["session"]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(h.sessions).toHaveBeenCalledTimes(2);
    h.controller.dispose();
  });

  it.each(["machine", "cwd", "file"] as const)("does not accept an old session read after same-id %s ABA", async (change) => {
    const h = setup();
    const gate = deferred<Awaited<ReturnType<typeof defaultApi.transcriptSnapshot>>>();
    h.snapshot.mockReturnValueOnce(gate.promise);
    const pending = h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);
    h.controller.retireReadRecoveries([change === "machine" ? "machine" : "session"]);
    if (change === "machine") h.setState({ selectedMachine: { id: "remote", kind: "remote", name: "Remote", baseUrl: "https://remote.test", createdAt: "now", updatedAt: "now" } });
    else h.setState({ selectedSession: { ...oldSession, ...(change === "cwd" ? { cwd: "/other" } : { path: "/other/file.jsonl" }) } });
    h.setState({ selectedMachine: undefined, selectedSession: oldSession });
    await pending;
    const accepted = h.getState();
    gate.resolve({ ...await transcriptSnapshotFixture(emptyPage, status(oldSession.id)), page: { messages: [{ role: "user", content: "old ABA" }], start: 0, total: 1 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.getState()).toBe(accepted);
    expect(h.getState().browserErrors).toEqual({});
    h.controller.dispose();
  });

  it("preserves a same-text newer recoverable error after an old snapshot succeeds", async () => {
    const gate = deferred<Awaited<ReturnType<typeof defaultApi.transcriptSnapshot>>>();
    const h = setup({ transcriptSnapshot: () => gate.promise });
    h.errors.report(sessionScope, "same failure", "session-refresh");
    const pending = h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);
    h.errors.report(sessionScope, "same failure", "session-refresh");
    const errors = h.getState().browserErrors;
    gate.resolve(await transcriptSnapshotFixture(emptyPage, status(oldSession.id)));
    await pending;
    expect(h.getState().browserErrors).toBe(errors);
    h.controller.dispose();
  });

  it("keeps the deferred first-paint boundary closed to recovery triggers", async () => {
    const h = setup();
    await h.controller.selectSession(oldSession, { deferChatLoading: true, updateUrl: false });
    await h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    h.controller.dispose();
  });
});

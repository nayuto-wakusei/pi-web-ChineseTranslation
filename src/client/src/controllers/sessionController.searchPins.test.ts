import { describe, expect, it, vi } from "vitest";
import { api as defaultApi, type SessionInfo } from "../api";
import { initialAppState, type AppState } from "../appState";
import { SessionController } from "./sessionController";
import { FakeSocket, deferred, workspace } from "./sessionController.testSupport";

describe("SessionController session search and pins", () => {
  it("debounces search, ignores stale results, and restores the full list when cleared", async () => {
    vi.useFakeTimers();
    try {
      let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
      const first = deferred<SessionInfo[]>();
      const second = deferred<SessionInfo[]>();
      const search = vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const api = { ...defaultApi, search };
      const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new FakeSocket() });

      controller.searchSessions("first");
      await vi.advanceTimersByTimeAsync(249);
      expect(search).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(search).toHaveBeenCalledWith("/repo", "first", "local");

      controller.searchSessions("second");
      await vi.advanceTimersByTimeAsync(250);
      second.resolve([{ ...workspaceSession("second-result"), firstMessage: "second" }]);
      await vi.runAllTimersAsync();
      expect(state.sessionSearchResults?.map((session) => session.id)).toEqual(["second-result"]);

      first.resolve([{ ...workspaceSession("stale-result"), firstMessage: "first" }]);
      await vi.runAllTimersAsync();
      expect(state.sessionSearchResults?.map((session) => session.id)).toEqual(["second-result"]);

      controller.searchSessions("");
      expect(state.sessionSearchQuery).toBe("");
      expect(state.sessionSearchResults).toBeUndefined();
      expect(state.isSearchingSessions).toBe(false);
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads pins from the server and rolls back a failed optimistic toggle", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const session = { ...workspaceSession("session-1"), persisted: true };
    const pin = vi.fn().mockResolvedValue({ pinned: true });
    const unpin = vi.fn().mockRejectedValue(new Error("pin unavailable"));
    const api = { ...defaultApi, pinned: vi.fn().mockResolvedValue({ sessionIds: ["session-1"] }), pin, unpin };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new FakeSocket() });

    await controller.refreshPinnedSessions("/repo");
    expect(state.pinnedSessionIds).toEqual(["session-1"]);

    controller.togglePinned(session);
    expect(state.pinnedSessionIds).toEqual([]);
    await Promise.resolve();
    expect(unpin).toHaveBeenCalledWith(session, "local");
    expect(state.pinnedSessionIds).toEqual(["session-1"]);
    expect(state.error).toContain("pin unavailable");
    expect(pin).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("refreshes the current workspace session list every few seconds", async () => {
    vi.useFakeTimers();
    try {
      let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
      const sessions = vi.fn().mockResolvedValue([workspaceSession("latest")]);
      const api = { ...defaultApi, sessions };
      const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new FakeSocket() });

      controller.updatePolling();
      await vi.advanceTimersByTimeAsync(4999);
      expect(sessions).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      expect(sessions).toHaveBeenCalledWith("/repo", "local");
      expect(state.sessions.map((session) => session.id)).toEqual(["latest"]);

      controller.dispose();
      sessions.mockClear();
      await vi.advanceTimersByTimeAsync(5000);
      expect(sessions).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

function workspaceSession(id: string): SessionInfo {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: workspace.path,
    created: "2026-06-09T00:00:00.000Z",
    modified: "2026-06-09T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
  };
}

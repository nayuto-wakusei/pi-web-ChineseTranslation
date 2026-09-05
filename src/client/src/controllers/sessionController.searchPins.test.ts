import { describe, expect, it, vi } from "vitest";
import { api as defaultApi, type SessionContentSearchResponse, type SessionInfo } from "../api";
import { initialAppState, type AppState } from "../appState";
import { SessionController } from "./sessionController";
import { FakeSocket, deferred, status, workspace } from "./sessionController.testSupport";

describe("SessionController session search and pins", () => {
  it("debounces search, ignores stale results, and restores the full list when cleared", async () => {
    vi.useFakeTimers();
    try {
      let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
      const first = deferred<SessionContentSearchResponse>();
      const second = deferred<SessionContentSearchResponse>();
      const searchContent = vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const api = { ...defaultApi, searchContent };
      const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new FakeSocket() });

      controller.searchSessions("first");
      await vi.advanceTimersByTimeAsync(249);
      expect(searchContent).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(searchContent).toHaveBeenCalledWith("/repo", "first", "local");

      controller.searchSessions("second");
      await vi.advanceTimersByTimeAsync(250);
      second.resolve({ results: [{ session: { ...workspaceSession("second-result"), firstMessage: "second" }, matches: [] }], matchCount: 1, truncated: false });
      await vi.runAllTimersAsync();
      expect(state.sessionSearchResults?.results.map((result) => result.session.id)).toEqual(["second-result"]);

      first.resolve({ results: [{ session: { ...workspaceSession("stale-result"), firstMessage: "first" }, matches: [] }], matchCount: 1, truncated: false });
      await vi.runAllTimersAsync();
      expect(state.sessionSearchResults?.results.map((result) => result.session.id)).toEqual(["second-result"]);

      controller.searchSessions("");
      expect(state.sessionSearchQuery).toBe("");
      expect(state.sessionSearchResults).toBeUndefined();
      expect(state.isSearchingSessions).toBe(false);
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads contiguous history through a selected match and records a stable search target", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const session = workspaceSession("session-1");
    const rawMessages = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 === 0 ? "user" : "assistant", content: `message ${String(index)}` }));
    const messages = vi.fn()
      .mockResolvedValueOnce({ messages: rawMessages.slice(8), start: 8, total: 10 })
      .mockResolvedValueOnce({ messages: rawMessages.slice(0, 8), start: 0, total: 10 });
    const api = {
      ...defaultApi,
      messages,
      status: vi.fn().mockResolvedValue(status("session-1")),
      streamSnapshot: vi.fn().mockResolvedValue({ seq: 0, partial: null }),
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new FakeSocket() });

    await controller.selectSearchMatch(session, {
      messageIndex: 1,
      role: "assistant",
      occurrenceCount: 1,
      excerpts: [{ text: "message 1", matchRanges: [{ start: 0, length: 7 }] }],
    }, "message");

    expect(messages).toHaveBeenNthCalledWith(2, session, { before: 8, limit: 500 }, "local");
    expect(state.messagePageStart).toBe(0);
    expect(state.messages.find((message) => message.transcriptIndex === 1)?.parts).toEqual([{ type: "text", text: "message 1" }]);
    expect(state.sessionSearchTarget).toEqual({ sessionId: "session-1", messageIndex: 1, query: "message", requestId: 1 });
    controller.dispose();
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
    expect(Object.values(state.browserErrors).map((error) => error.message).join("\n")).toContain("pin unavailable");
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

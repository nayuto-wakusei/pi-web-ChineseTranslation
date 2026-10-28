import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionsApi } from "../api/clients";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, EmitSocket, emptyPage, oldSession, replacementSession, status, workspace, type AppState } from "./sessionController.testSupport";

function setup() {
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
  const fetchMock = vi.fn<typeof fetch>().mockReturnValue(new Promise(() => undefined));
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
  vi.stubGlobal("fetch", fetchMock);
  const socket = new EmitSocket();
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, {
    socket,
    api: { ...defaultApi, transcriptSnapshot: sessionsApi.transcriptSnapshot, thinkingLevels: () => Promise.resolve({ levels: [] }) },
  });
  return { controller, socket, fetchMock, getState: () => state };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("selected-session read deadlines", () => {
  it("exhausts stalled HTTP recovery in bounded time and releases the coordinator for a later read", async () => {
    const h = setup();
    const refresh = h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(45_000);
    await refresh;
    expect(h.fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of h.fetchMock.mock.calls) expect(init?.signal?.aborted).toBe(true);
    expect(Object.values(h.getState().browserErrors)).toMatchObject([{ recovery: "session-refresh" }]);

    h.fetchMock.mockResolvedValue(new Response(JSON.stringify({ page: emptyPage, status: status(oldSession.id), seq: 0, partial: null })));
    await h.controller.refreshSelectedSession();
    expect(h.fetchMock).toHaveBeenCalledTimes(5);
    expect(h.getState().browserErrors).toEqual({});
    h.controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["deselect", "reselect", "dispose"] as const)("cancels a stalled read on %s without reporting a stale failure", async (operation) => {
    const h = setup();
    const refresh = h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);
    const signal = h.fetchMock.mock.calls[0]?.[1]?.signal;
    if (operation === "deselect") h.controller.clearActiveSession();
    else if (operation === "dispose") h.controller.dispose();
    else await h.controller.selectSession(replacementSession, { deferChatLoading: true });
    await refresh;
    expect(signal?.aborted).toBe(true);
    expect(h.fetchMock).toHaveBeenCalledOnce();
    expect(h.getState().browserErrors).toEqual({});
    h.controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases buffered live output at the deadline, before the next recovery attempt", async () => {
    const h = setup();
    h.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ page: emptyPage, status: status(oldSession.id), seq: 0, partial: null })));
    await h.controller.selectSession(oldSession, { updateUrl: false });
    const refresh = h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
    await vi.advanceTimersByTimeAsync(0);
    h.socket.emit({ type: "assistant.delta", text: "live output", seq: 1 });
    h.controller.flushPendingUpdates();
    expect(h.getState().messages).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    h.controller.flushPendingUpdates();
    expect(h.getState().messages).toMatchObject([{ parts: [{ type: "text", text: "live output" }] }]);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    h.controller.dispose();
    await vi.advanceTimersByTimeAsync(500);
    await refresh;
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });
});

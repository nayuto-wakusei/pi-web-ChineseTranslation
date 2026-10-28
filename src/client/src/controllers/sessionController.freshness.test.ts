import { describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { SessionConnectionState } from "../sessionSocket";
import { SessionController, type SessionEventSocket } from "./sessionController";
import { defaultApi, deferred, EmitSocket, emptyPage, oldSession, status, transcriptSnapshotFixture, workspace, type SessionTranscriptSnapshot } from "./sessionController.testSupport";

class ConnectionSocket extends EmitSocket {
  private onState: ((state: SessionConnectionState) => void) | undefined;

  override connect(...args: Parameters<SessionEventSocket["connect"]>): void {
    super.connect(args[0], args[1], args[2], args[3], args[4]);
    this.onState = args[5];
    this.state("connecting");
  }

  state(state: SessionConnectionState): void { this.onState?.(state); }

  override open(): void {
    this.state("open");
    super.open();
  }

  override reconnect(): void { this.state("connecting"); }
}

function setup() {
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
  const socket = new ConnectionSocket();
  const snapshot = vi.fn<typeof defaultApi.transcriptSnapshot>(() => transcriptSnapshotFixture(emptyPage, status(oldSession.id)));
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, {
    socket,
    api: { ...defaultApi, transcriptSnapshot: snapshot, thinkingLevels: () => Promise.resolve({ levels: [] }) },
  });
  return { controller, socket, snapshot, getState: () => state };
}

describe("conversation freshness feedback", () => {
  it("records when history was checked without promising continuous live delivery", async () => {
    const h = setup();
    await h.controller.selectSession(oldSession);
    expect(h.getState().conversationSync).toBe("stale");
    expect(h.getState().conversationRefreshedAt).toEqual(expect.any(Number));
    const pending = deferred<SessionTranscriptSnapshot>();
    h.snapshot.mockImplementation(() => pending.promise);
    h.socket.open();
    expect(h.getState().conversationSync).toBe("stale");
    pending.resolve(await transcriptSnapshotFixture({ start: 0, total: 1, messages: [{ role: "assistant", content: [{ type: "text", text: "Missed output" }] }] }, status(oldSession.id), { seq: 5, partial: null }));
    await vi.waitFor(() => { expect(h.getState().conversationSync).toBe("checked"); });
    expect(JSON.stringify(h.getState().messages)).toContain("Missed output");
    h.controller.dispose();
  });

  it("keeps possible stale delivery visible even when an HTTP read succeeds", async () => {
    const h = setup();
    await h.controller.selectSession(oldSession);
    h.socket.open();
    await vi.waitFor(() => { expect(h.getState().conversationSync).toBe("checked"); });
    h.socket.state("connecting");
    await h.controller.refreshSelectedSession();
    expect(h.getState().conversationSync).toBe("stale");
    expect(h.getState().conversationRefreshedAt).toEqual(expect.any(Number));
    h.controller.dispose();
  });

  it("leaves old messages and their checked time available when refreshing fails", async () => {
    const h = setup();
    await h.controller.selectSession(oldSession);
    const checkedAt = h.getState().conversationRefreshedAt;
    const messages = h.getState().messages;
    h.snapshot.mockRejectedValue(new Error("Connection unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await h.controller.refreshSelectedSession(undefined, { silent: true });
      expect(h.getState().conversationSync).toBe("interrupted");
      expect(h.getState().conversationRefreshedAt).toBe(checkedAt);
      expect(h.getState().messages).toBe(messages);
    } finally { warn.mockRestore(); h.controller.dispose(); }
  });

  it("lets the replacement socket own resume catch-up rather than fetching twice", async () => {
    const h = setup();
    await h.controller.selectSession(oldSession);
    h.socket.open();
    await vi.waitFor(() => { expect(h.getState().conversationSync).toBe("checked"); });
    h.snapshot.mockClear();
    await h.controller.resumeSelectedSession();
    expect(h.getState().conversationSync).toBe("stale");
    expect(h.snapshot).not.toHaveBeenCalled();
    h.socket.open();
    await vi.waitFor(() => { expect(h.getState().conversationSync).toBe("checked"); });
    expect(h.snapshot).toHaveBeenCalledOnce();
    h.controller.clearActiveSession();
    expect(h.getState().conversationSync).toBeUndefined();
    expect(h.getState().conversationRefreshedAt).toBeUndefined();
    h.controller.dispose();
  });
});

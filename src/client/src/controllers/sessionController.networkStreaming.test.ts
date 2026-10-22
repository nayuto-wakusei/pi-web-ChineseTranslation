import { NetworkRequestError } from "../api/http";
import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import type { PendingExtensionDialog, SessionTranscriptSnapshot } from "../api";
import type { SessionUiEvent } from "../sessionSocket";
import { SessionController } from "./sessionController";
import type { ChatLine } from "../components/shared";
import { defaultApi, deferred, EmitSocket, oldSession, replacementSession, runPendingAnimationFrames, status, workspace, type AppState } from "./sessionController.testSupport";

const oldPage = {
  messages: [
    { role: "user", content: "first question" },
    { role: "assistant", content: [{ type: "text", text: "previous answer" }] },
  ],
  start: 0,
  total: 2,
};

function snapshot(overrides: Partial<SessionTranscriptSnapshot> = {}): SessionTranscriptSnapshot {
  return { page: oldPage, status: status(oldSession.id), seq: 10, partial: null, ...overrides };
}

function harness() {
  const socket = new EmitSocket();
  let nextSnapshot = Promise.resolve(snapshot());
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession, replacementSession] };
  const transcriptSnapshot = vi.fn(() => nextSnapshot);
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    { socket, api: { ...defaultApi, transcriptSnapshot, thinkingLevels: () => Promise.resolve({ levels: [] }) } },
  );
  return {
    socket, controller, transcriptSnapshot,
    state: () => state,
    nextSnapshot: (next: Promise<SessionTranscriptSnapshot>) => { nextSnapshot = next; },
  };
}

function secondUserEvent(seq = 12): SessionUiEvent {
  return { type: "message.append", message: { role: "user", content: "second question" }, seq };
}

const twoTurns = [
  { role: "user", parts: [{ type: "text", text: "first question" }] },
  { role: "assistant", parts: [{ type: "text", text: "previous answer" }] },
  { role: "user", parts: [{ type: "text", text: "second question" }] },
  { role: "assistant", parts: [{ type: "text", text: "new answer" }] },
];

const secondQuestionPage = {
  ...oldPage,
  messages: [...oldPage.messages, { role: "user", content: "second question" }],
  total: 3,
};

const streamingStatus = { ...status(oldSession.id), isStreaming: true };

function partial(text: string): unknown {
  return { role: "assistant", content: [{ type: "text", text }] };
}

function withoutTranscriptIndexes(messages: ChatLine[]): ChatLine[] {
  return messages.map((line) => { const copy = { ...line }; delete copy.transcriptIndex; return copy; });
}

describe("network recovery streaming reconciliation", () => {
  it("starts a genuine trailing read after an initial-ready join without assuming microtask counts", async () => {
    const h = harness();
    try {
      await h.controller.selectSession(oldSession, { updateUrl: false });
      const first = deferred<SessionTranscriptSnapshot>();
      const trailing = deferred<SessionTranscriptSnapshot>();
      const firstStarted = deferred<undefined>();
      const trailingStarted = deferred<undefined>();
      h.transcriptSnapshot.mockImplementationOnce(() => {
        firstStarted.resolve(undefined);
        return first.promise;
      }).mockImplementationOnce(() => {
        trailingStarted.resolve(undefined);
        return trailing.promise;
      });
      const refresh = h.controller.refreshSelectedSession();
      await firstStarted.promise;
      h.socket.emit(secondUserEvent());
      h.socket.emit({ type: "assistant.delta", text: "new", seq: 13 });
      const next = h.controller.refreshSelectedSession();
      first.resolve(snapshot());
      await trailingStarted.promise;
      h.socket.emit({ type: "assistant.delta", text: " answer", seq: 14 });
      trailing.resolve(snapshot({ page: secondQuestionPage, status: streamingStatus, seq: 13, partial: partial("new") }));
      await Promise.all([refresh, next]);
      runPendingAnimationFrames();
      expect(h.transcriptSnapshot).toHaveBeenCalledTimes(3);
      expect(withoutTranscriptIndexes(h.state().messages)).toEqual(twoTurns);
    } finally {
      h.controller.dispose();
    }
  });
  it("keeps live output and dialogs visible during backoff, even when another caller requests a refresh", async () => {
    vi.useFakeTimers();
    const h = harness();
    const dialog: PendingExtensionDialog = { dialogId: "retry-dialog", kind: "confirm", title: "Continue?", askedAt: "now", runScoped: true };
    try {
      await h.controller.selectSession(oldSession, { updateUrl: false });
      const failedRead = deferred<SessionTranscriptSnapshot>();
      h.transcriptSnapshot.mockImplementationOnce(() => failedRead.promise);
      const recoveredSnapshot = snapshot({
        page: secondQuestionPage, status: { ...streamingStatus, pendingDialogs: [dialog] }, seq: 14, partial: partial("new answer"),
      });
      h.nextSnapshot(Promise.resolve(recoveredSnapshot));
      const refresh = h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
      await vi.advanceTimersByTimeAsync(0);
      h.socket.emit(secondUserEvent());
      failedRead.reject(new NetworkRequestError("Load failed"));
      await vi.advanceTimersByTimeAsync(0);
      runPendingAnimationFrames();
      expect(h.state().messages).toHaveLength(3);

      const coalesced = h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
      h.socket.emit({ type: "assistant.delta", text: "new answer", seq: 13 });
      h.socket.emit({ type: "dialog.opened", dialog, seq: 14 });
      runPendingAnimationFrames();
      expect(withoutTranscriptIndexes(h.state().messages)).toEqual(twoTurns);
      expect(h.state().pendingDialogs).toEqual([dialog]);
      expect(h.state().browserErrors).toEqual({});

      await vi.advanceTimersByTimeAsync(500);
      await Promise.all([refresh, coalesced]);
      runPendingAnimationFrames();
      expect(withoutTranscriptIndexes(h.state().messages)).toEqual(twoTurns);
      expect(h.state().pendingDialogs).toEqual([dialog]);
      expect(h.state().browserErrors).toEqual({});
    } finally {
      h.controller.dispose();
      vi.useRealTimers();
    }
  });

  it("keeps streaming events and dialogs after exhausting HTTP recovery", async () => {
    vi.useFakeTimers();
    const h = harness();
    const dialog: PendingExtensionDialog = { dialogId: "retry-dialog", kind: "confirm", title: "Continue?", askedAt: "now", runScoped: true };
    try {
      await h.controller.selectSession(oldSession, { updateUrl: false });
      h.transcriptSnapshot.mockRejectedValue(new NetworkRequestError("Load failed"));
      const refresh = h.controller.refreshSelectedSession(undefined, { recoverNetwork: true });
      await vi.advanceTimersByTimeAsync(0);
      h.socket.emit(secondUserEvent());
      h.socket.emit({ type: "assistant.delta", text: "new answer", seq: 13 });
      h.socket.emit({ type: "dialog.opened", dialog, seq: 14 });
      runPendingAnimationFrames();
      expect(withoutTranscriptIndexes(h.state().messages)).toEqual(twoTurns);
      expect(h.state().pendingDialogs).toEqual([dialog]);
      await vi.runAllTimersAsync();
      await refresh;
      runPendingAnimationFrames();
      expect(withoutTranscriptIndexes(h.state().messages)).toEqual(twoTurns);
      expect(h.state().pendingDialogs).toEqual([dialog]);
      expect(Object.values(h.state().browserErrors).map((error) => error.recovery)).toEqual(["session-refresh"]);
    } finally {
      h.controller.dispose();
      vi.useRealTimers();
    }
  });

});

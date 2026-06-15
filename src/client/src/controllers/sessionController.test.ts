import { afterEach, describe, expect, it } from "vitest";
import { api as defaultApi, type MessagePage, type PromptAttachment, type SessionActivity, type SessionInfo, type SessionRef, type SessionStatus, type Workspace } from "../api";
import { isCachedNewSessionInfo, loadCachedNewSessions, markCachedNewSessionInfo, rememberCachedNewSession } from "../cachedNewSessions";
import { initialAppState, type AppState } from "../appState";
import { machineSessionKey } from "../machineKeys";
import { PI_WEB_CAPABILITIES } from "../../../shared/capabilities";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { SessionController, type SessionEventSocket } from "./sessionController";
import { InMemorySessionSelectionMemory } from "./sessionSelection";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class FakeSocket implements SessionEventSocket {
  readonly connectedSessionIds: string[] = [];

  connect(session: SessionRef): void {
    this.connectedSessionIds.push(session.id);
  }

  setHandler(): void {
    // Test socket does not emit events.
  }

  close(): void {
    // No-op.
  }
}

const workspace: Workspace = {
  id: "workspace-1",
  projectId: "project-1",
  path: "/repo",
  label: "repo",
  isMain: true,
  isGitRepo: true,
  isGitWorktree: false,
};

const oldSession: SessionInfo = {
  id: "old-session",
  path: "/tmp/old-session.jsonl",
  cwd: "/repo",
  created: "2026-05-15T00:00:00.000Z",
  modified: "2026-05-15T00:00:00.000Z",
  messageCount: 0,
  firstMessage: "",
};

const replacementSession: SessionInfo = {
  ...oldSession,
  id: "new-session",
  path: "/tmp/new-session.jsonl",
};

const emptyPage: MessagePage = { messages: [], start: 0, total: 0 };

function status(sessionId: string): SessionStatus {
  return {
    sessionId,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

describe("SessionController", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
  });

  it("clears stale active activity when an idle status arrives", () => {
    const activeActivity: SessionActivity = { sessionId: oldSession.id, phase: "active", label: "running tool", at: "2026-05-15T00:00:00.000Z" };
    let state: AppState = {
      ...initialAppState(),
      selectedSession: oldSession,
      sessions: [oldSession],
      activity: activeActivity,
      sessionActivities: { [oldSession.id]: activeActivity },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { socket: new FakeSocket() },
    );

    controller.applyGlobalEvent({ type: "status.update", status: status(oldSession.id) });

    expect(state.activity).toBeUndefined();
    expect(state.sessionActivities[oldSession.id]).toBeUndefined();
    expect(state.sessionStatuses[oldSession.id]).toMatchObject({ sessionId: oldSession.id, isStreaming: false });
  });

  it("updates visible session message counts from live status events", () => {
    let state: AppState = {
      ...initialAppState(),
      selectedSession: oldSession,
      sessions: [oldSession],
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { socket: new FakeSocket() },
    );

    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), messageCount: 3 } });

    expect(state.sessions[0]?.messageCount).toBe(3);
    expect(state.selectedSession?.messageCount).toBe(3);
  });

  it("toggles the per-session sending state around an inline attachment send and forwards attachments", async () => {
    let resolvePrompt: (() => void) | undefined;
    let promptArgs: { attachments?: PromptAttachment[] } | undefined;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const attachments: PromptAttachment[] = [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }];
    const api: typeof defaultApi = {
      ...defaultApi,
      prompt: (_session, _text, _behavior, _machineId, sentAttachments) => new Promise<{ accepted: true }>((resolve) => {
        promptArgs = { ...(sentAttachments === undefined ? {} : { attachments: sentAttachments }) };
        resolvePrompt = () => { resolve({ accepted: true }); };
      }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const send = controller.send("look", undefined, attachments, "inline");
    const sendingDuringPrompt = state.sendingPrompts;
    resolvePrompt?.();
    await send;

    expect(sendingDuringPrompt).toEqual({ [oldSession.id]: true });
    expect(state.sendingPrompts).toEqual({});
    expect(promptArgs).toEqual({ attachments });
  });

  it("keeps the sending state scoped to the originating session when the user switches away", async () => {
    let resolvePrompt: (() => void) | undefined;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession, replacementSession] };
    const attachments: PromptAttachment[] = [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }];
    const api: typeof defaultApi = {
      ...defaultApi,
      prompt: () => new Promise<{ accepted: true }>((resolve) => { resolvePrompt = () => { resolve({ accepted: true }); }; }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const send = controller.send("look", undefined, attachments, "inline");
    // While the upload is in flight, deselecting must not clear the originating
    // session's sending entry, and it must stay keyed to that session only.
    controller.deselectSession();
    expect(state.sendingPrompts).toEqual({ [oldSession.id]: true });
    expect(state.sendingPrompts[replacementSession.id]).toBeUndefined();
    resolvePrompt?.();
    await send;
    expect(state.sendingPrompts).toEqual({});
  });

  it("uploads to the workspace folder and rewrites the prompt for folder delivery", async () => {
    let savedCalledWith: PromptAttachment[] | undefined;
    let promptText: string | undefined;
    let promptAttachments: PromptAttachment[] | undefined;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const attachments: PromptAttachment[] = [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }];
    const api: typeof defaultApi = {
      ...defaultApi,
      saveAttachments: (_session, sent) => { savedCalledWith = sent; return Promise.resolve([{ path: ".pi-web/paste/shot.png", mimeType: "image/png", size: 3 }]); },
      prompt: (_session, text, _behavior, _machineId, sentAttachments) => { promptText = text; promptAttachments = sentAttachments; return Promise.resolve({ accepted: true }); },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.send("check this", undefined, attachments, "folder");

    expect(savedCalledWith).toEqual(attachments);
    expect(promptText).toBe("check this\n\n@.pi-web/paste/shot.png");
    expect(promptAttachments).toBeUndefined();
    expect(state.sendingPrompts).toEqual({});
  });

  it("does not set the sending state for plain text messages", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const seen: Record<string, true>[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      prompt: () => { seen.push({ ...state.sendingPrompts }); return Promise.resolve({ accepted: true }); },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.send("hello");
    expect(seen).toEqual([{}]);
    expect(state.sendingPrompts).toEqual({});
  });

  it("keeps live message count updates when a cached new session becomes persisted", async () => {
    const cachedSession = markCachedNewSessionInfo(oldSession);
    let resolvePrompt: (() => void) | undefined;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: cachedSession, sessions: [cachedSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      prompt: () => new Promise<{ accepted: true }>((resolve) => { resolvePrompt = () => { resolve({ accepted: true }); }; }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const send = controller.send("hello");
    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), messageCount: 1 } });
    resolvePrompt?.();
    await send;

    expect(state.sessions[0]?.messageCount).toBe(1);
    expect(isCachedNewSessionInfo(state.sessions[0])).toBe(false);
    expect(state.selectedSession?.messageCount).toBe(1);
  });

  it("recreates missing browser-cached new sessions and moves their draft", async () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    rememberCachedNewSession(oldSession);
    saveDraft(sessionKey(oldSession.id), "draft text");

    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [markCachedNewSessionInfo(oldSession)] };
    const urlUpdates: ({ replace?: boolean | undefined } | undefined)[] = [];
    const socket = new FakeSocket();
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(replacementSession),
      messages: (session) => {
        if (sessionLookupId(session) === oldSession.id) return Promise.reject(new Error("Session not found"));
        return Promise.resolve(emptyPage);
      },
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      (options) => { urlUpdates.push(options); },
      undefined,
      { api, socket },
    );

    await controller.selectSession(markCachedNewSessionInfo(oldSession), { updateUrl: false });

    expect(state.selectedSession?.id).toBe(replacementSession.id);
    expect(state.sessions.map((session) => session.id)).toEqual([replacementSession.id]);
    expect(socket.connectedSessionIds).toEqual([oldSession.id, replacementSession.id]);
    expect(loadDraft(sessionKey(oldSession.id))).toBe("");
    expect(loadDraft(sessionKey(replacementSession.id))).toBe("draft text");
    expect(loadCachedNewSessions().map((session) => session.id)).toEqual([replacementSession.id]);
    expect(urlUpdates).toEqual([{ replace: true }]);
  });

  it("stores command prompt drafts for replacement sessions before selecting them", async () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      commandDialog: { type: "select", requestId: "r1", title: "Fork from message", options: [{ value: "m1", label: "fork me" }] },
    };
    const urlUpdates: unknown[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      respondToCommand: () => Promise.resolve({ type: "done", message: "Session forked", session: replacementSession, promptDraft: "fork me" }),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      (options) => { urlUpdates.push(options); },
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.respondToCommand("r1", "m1");

    expect(state.commandDialog).toBeUndefined();
    expect(loadDraft(sessionKey(replacementSession.id))).toBe("fork me");
  });

  it("forgets the selected active session when archiving leaves only archived sessions", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const urlUpdates: ({ replace?: boolean | undefined } | undefined)[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      archive: () => Promise.resolve({ archived: true }),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      (options) => { urlUpdates.push(options); },
      new InMemorySessionSelectionMemory(),
      { api, socket: new FakeSocket() },
    );

    await controller.selectSession(oldSession, { updateUrl: false });
    await controller.archiveSession();

    expect(state.selectedSession).toBeUndefined();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({ ...oldSession, archived: true });
    expect(typeof state.sessions[0]?.archivedAt).toBe("string");
    expect(controller.preferredSession(workspace.path, state.sessions, undefined)).toBeUndefined();
    expect(urlUpdates).toEqual([undefined]);
  });

  it("archives selected session descendants and selects the next active session", async () => {
    const childSession = { ...oldSession, id: "child-session", path: "/tmp/child-session.jsonl", parentSessionPath: oldSession.path };
    const nextSession = { ...oldSession, id: "next-session", path: "/tmp/next-session.jsonl" };
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession, childSession, nextSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      archiveWithDescendants: () => Promise.resolve({ archived: true, sessionIds: [oldSession.id, childSession.id], archivedCount: 2, skippedAlreadyArchivedCount: 0 }),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      { api, socket: new FakeSocket() },
    );

    await controller.selectSession(oldSession, { updateUrl: false });
    await controller.archiveSessionWithDescendants(oldSession);

    expect(state.sessions.find((session) => session.id === oldSession.id)).toMatchObject({ archived: true });
    expect(state.sessions.find((session) => session.id === childSession.id)).toMatchObject({ archived: true });
    expect(state.selectedSession?.id).toBe(nextSession.id);
  });

  it("archives selected sessions in bulk", async () => {
    const secondSession = { ...oldSession, id: "second-session", path: "/tmp/second-session.jsonl" };
    const nextSession = { ...oldSession, id: "next-session", path: "/tmp/next-session.jsonl" };
    const archivedIds: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession, secondSession, nextSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      archive: (session) => {
        archivedIds.push(sessionLookupId(session));
        return Promise.resolve({ archived: true });
      },
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      { api, socket: new FakeSocket() },
    );

    await controller.selectSession(oldSession, { updateUrl: false });
    await controller.archiveSessions([oldSession, secondSession]);

    expect(archivedIds).toEqual([oldSession.id, secondSession.id]);
    expect(state.sessions.find((session) => session.id === oldSession.id)).toMatchObject({ archived: true });
    expect(state.sessions.find((session) => session.id === secondSession.id)).toMatchObject({ archived: true });
    expect(state.selectedSession?.id).toBe(nextSession.id);
  });

  it("deletes selected archived sessions in bulk and selects the next current session", async () => {
    const archivedSession = { ...oldSession, archived: true, archivedAt: "later" };
    const nextSession = { ...oldSession, id: "next-session", path: "/tmp/next-session.jsonl" };
    const deletedIds: string[] = [];
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: archivedSession,
      sessions: [archivedSession, nextSession],
      machineRuntimes: { local: { machineId: "local", ok: true, checkedAt: "now", capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived] } },
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      deleteArchived: (session) => {
        deletedIds.push(sessionLookupId(session));
        return Promise.resolve({ deleted: true });
      },
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      { api, socket: new FakeSocket() },
    );

    await controller.deleteArchivedSessions([archivedSession]);

    expect(deletedIds).toEqual([archivedSession.id]);
    expect(state.sessions.map((session) => session.id)).toEqual([nextSession.id]);
    expect(state.selectedSession?.id).toBe(nextSession.id);
  });

  it("does not delete archived sessions when the selected machine runtime does not support it", async () => {
    const archivedSession = { ...oldSession, archived: true, archivedAt: "later" };
    const deletedIds: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [archivedSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      deleteArchived: (session) => {
        deletedIds.push(sessionLookupId(session));
        return Promise.resolve({ deleted: true });
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      { api, socket: new FakeSocket() },
    );

    await controller.deleteArchivedSessions([archivedSession]);

    expect(deletedIds).toEqual([]);
    expect(state.sessions).toEqual([archivedSession]);
    expect(state.error).toContain("requires an updated Pi-Web runtime");
  });

  it("reloads the selected session, discards the cached transcript, and re-fetches history", async () => {
    Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
    const reloadCalls: string[] = [];
    const messageCalls: string[] = [];
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
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
        return Promise.resolve(emptyPage);
      },
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      new InMemorySessionSelectionMemory(),
      { api, socket: new FakeSocket() },
    );

    await controller.reloadSession(oldSession);

    expect(reloadCalls).toEqual([oldSession.id]);
    expect(messageCalls).toContain(oldSession.id);
    expect(state.error).toBe("");
  });

  it("does not reload sessions when the selected machine runtime does not support it", async () => {
    const reloadCalls: string[] = [];
    let state: AppState = {
      ...initialAppState(),
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

    expect(reloadCalls).toEqual([]);
    expect(state.error).toContain("requires an updated Pi-Web runtime");
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

    controller.clearSelectionAfterArchivedCollapse();

    expect(state.selectedSession).toBeUndefined();
    expect(controller.preferredSession(workspace.path, state.sessions, undefined)).toBeUndefined();
    expect(urlUpdates).toEqual([undefined]);
  });
});

function sessionKey(sessionId: string): string {
  return machineSessionKey("local", sessionId);
}

function sessionLookupId(session: string | SessionRef): string {
  return typeof session === "string" ? session : session.id;
}

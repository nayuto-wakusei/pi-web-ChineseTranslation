import { afterEach, beforeEach, vi } from "vitest";
import { api as defaultApi } from "../api";
import type { MessagePage, SessionInfo, SessionRef, SessionStatus, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { machineSessionKey } from "../machineKeys";
import type { SessionUiEvent } from "../sessionSocket";
import { SessionController, type SessionControllerDependencies, type SessionEventSocket } from "./sessionController";

export { defaultApi };
export type { MessagePage, PromptAttachment, SessionActivity, SessionInfo, SessionRef, SessionStatus, SessionStreamSnapshot, Workspace } from "../api";
export type { AppState };

export interface SessionControllerTestFixtureOptions {
  initialState?: AppState;
  api?: Partial<typeof defaultApi>;
  socket?: SessionEventSocket;
  dependencies?: Omit<SessionControllerDependencies, "api" | "socket">;
}

export interface SessionControllerTestFixture {
  readonly controller: SessionController;
  readonly api: typeof defaultApi;
  readonly socket: SessionEventSocket;
  readonly stateWrites: Partial<AppState>[];
  readonly state: AppState;
  readonly replaceState: (state: AppState) => void;
}

export function createSessionControllerTestFixture(options: SessionControllerTestFixtureOptions = {}): SessionControllerTestFixture {
  let state = options.initialState ?? initialAppState();
  const stateWrites: Partial<AppState>[] = [];
  const replaceState = (nextState: AppState): void => { state = nextState; };
  const api = { ...defaultApi, ...options.api };
  const socket = options.socket ?? new FakeSocket();
  const controller = new SessionController(
    () => state,
    (patch) => {
      stateWrites.push(patch);
      state = { ...state, ...patch };
    },
    () => undefined,
    undefined,
    { ...options.dependencies, api, socket },
  );
  return {
    controller,
    api,
    socket,
    stateWrites,
    replaceState,
    get state() { return state; },
  };
}

export { MemoryStorage } from "../browserStorage.testSupport";

export class FakeSocket implements SessionEventSocket {
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

export class EmitSocket implements SessionEventSocket {
  readonly connectedSessionIds: string[] = [];
  private handler: ((event: SessionUiEvent) => void) | undefined;
  private onInitialOpen: (() => void) | undefined;

  connect(
    session: SessionRef,
    onEvent: (event: SessionUiEvent) => void,
    _onReconnect?: () => void,
    _machineId?: string,
    onInitialOpen?: () => void,
  ): void {
    this.connectedSessionIds.push(session.id);
    this.handler = onEvent;
    this.onInitialOpen = onInitialOpen;
  }

  setHandler(onEvent: (event: SessionUiEvent) => void): void {
    this.handler = onEvent;
  }

  emit(event: SessionUiEvent): void {
    this.handler?.(event);
  }

  open(): void {
    this.onInitialOpen?.();
  }

  close(): void {
    this.handler = undefined;
    this.onInitialOpen = undefined;
  }
}

export const workspace: Workspace = {
  id: "workspace-1",
  projectId: "project-1",
  path: "/repo",
  label: "repo",
  isMain: true,
  isGitRepo: true,
  isGitWorktree: false,
};

export const oldSession: SessionInfo = {
  id: "old-session",
  path: "/tmp/old-session.jsonl",
  cwd: "/repo",
  created: "2026-05-15T00:00:00.000Z",
  modified: "2026-05-15T00:00:00.000Z",
  messageCount: 0,
  firstMessage: "",
};

export const replacementSession: SessionInfo = {
  ...oldSession,
  id: "new-session",
  path: "/tmp/new-session.jsonl",
};

export const emptyPage: MessagePage = { messages: [], start: 0, total: 0 };

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolveDeferred: ((value: T) => void) | undefined;
  let rejectDeferred: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  if (resolveDeferred === undefined || rejectDeferred === undefined) throw new Error("Deferred promise was not initialized");
  return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}

export function status(sessionId: string): SessionStatus {
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

const framesById = new Map<number, () => void>();
let nextFrameId = 1;

// The controller coalesces status/activity/transcript updates behind
// requestAnimationFrame. The node test environment has no rAF, so install a
// controllable one: callbacks are queued and only run when a test drives a
// frame, mirroring how the browser defers them until paint.
beforeEach(() => {
  framesById.clear();
  nextFrameId = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    const id = nextFrameId++;
    framesById.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { framesById.delete(id); });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
});

export function runPendingAnimationFrames(): void {
  const frames = Array.from(framesById.values());
  framesById.clear();
  for (const frame of frames) frame();
}

export function sessionKey(sessionId: string): string {
  return machineSessionKey("local", sessionId);
}

export function sessionLookupId(session: string | SessionRef): string {
  return typeof session === "string" ? session : session.id;
}

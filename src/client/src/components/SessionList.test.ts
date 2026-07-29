import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionStatus } from "../api";
import { markCachedNewSessionInfo } from "../cachedNewSessions";
import { isArchivableSessionInfo, isTransientNewSessionInfo } from "../sessionPersistence";
import { SessionList, isRenamableSession, sessionRenameInput, sessionRowActivityKind, sessionRowsForCurrentTree, sessionsForSearchResults } from "./SessionList";

describe("session search entry", () => {
  it("remains rendered when the session section is collapsed", () => {
    const list = new SessionList();
    list.collapsed = true;

    const search = list.renderSearchInput();

    expect(search).not.toBeNull();
  });
});

describe("sessionRowActivityKind", () => {
  const idle = sessionStatus("s");

  it("reports 'sending' for an uploading session, taking precedence over server activity", () => {
    expect(sessionRowActivityKind(session("s"), idle, undefined, true)).toBe("sending");
    expect(sessionRowActivityKind(session("s"), { ...idle, isStreaming: true }, undefined, true)).toBe("sending");
  });

  it("reports 'session' for server activity when not sending", () => {
    expect(sessionRowActivityKind(session("s"), { ...idle, isStreaming: true }, undefined, false)).toBe("session");
  });

  it("reports undefined when idle and not sending", () => {
    expect(sessionRowActivityKind(session("s"), idle, undefined, false)).toBeUndefined();
  });

  it("never shows an indicator for archived or cached-new sessions, even while sending", () => {
    expect(sessionRowActivityKind({ ...session("s"), archived: true }, idle, undefined, true)).toBeUndefined();
    expect(sessionRowActivityKind(markCachedNewSessionInfo(session("s")), idle, undefined, true)).toBeUndefined();
  });
});

describe("session action eligibility", () => {
  it("requires a persisted server signal before archiving when persistence is authoritative", () => {
    const authoritative = { authoritative: true };
    expect(isArchivableSessionInfo(session("persisted", { persisted: true }), undefined, authoritative)).toBe(true);
    expect(isArchivableSessionInfo(session("unknown"), undefined, authoritative)).toBe(false);
    expect(isArchivableSessionInfo(session("transient", { persisted: false }), undefined, authoritative)).toBe(false);
    expect(isArchivableSessionInfo({ ...session("archived", { persisted: true }), archived: true, archivedAt: "2026-06-09T00:00:00.000Z" }, undefined, authoritative)).toBe(false);
  });

  it("preserves legacy archiving when persistence support is not advertised", () => {
    expect(isArchivableSessionInfo(session("legacy"))).toBe(true);
    expect(isTransientNewSessionInfo(session("legacy"))).toBe(false);
  });

  it("allows deleting transient non-archived sessions from server or browser-cached signals", () => {
    expect(isTransientNewSessionInfo(session("transient", { persisted: false }))).toBe(true);
    expect(isTransientNewSessionInfo(markCachedNewSessionInfo(session("cached")))).toBe(true);
    expect(isTransientNewSessionInfo(session("persisted", { persisted: true }))).toBe(false);
    expect(isTransientNewSessionInfo({ ...session("archived", { persisted: false }), archived: true, archivedAt: "2026-06-09T00:00:00.000Z" })).toBe(false);
  });

  it("uses matching status as the freshest persistence signal", () => {
    const staleTransient = session("s", { persisted: false });
    expect(isArchivableSessionInfo(staleTransient, sessionStatus("s", { persisted: true }))).toBe(true);
    expect(isTransientNewSessionInfo(staleTransient, sessionStatus("s", { persisted: true }))).toBe(false);

    const stalePersisted = session("s", { persisted: true });
    expect(isArchivableSessionInfo(stalePersisted, sessionStatus("s", { persisted: false }))).toBe(false);
    expect(isTransientNewSessionInfo(stalePersisted, sessionStatus("s", { persisted: false }))).toBe(true);

    expect(isArchivableSessionInfo(staleTransient, sessionStatus("other", { persisted: true }))).toBe(false);
  });
});

describe("sessionRenameInput", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefills the session label and trims a new name", () => {
    const prompt = vi.fn(() => "  新名称  ");
    vi.stubGlobal("prompt", prompt);

    expect(sessionRenameInput(session("s", { name: "已有名称" }))).toBe("新名称");
    expect(prompt).toHaveBeenCalledWith("重命名会话", "已有名称");
  });

  it("ignores cancelled and blank inputs", () => {
    vi.stubGlobal("prompt", () => null);
    expect(sessionRenameInput(session("s"))).toBeUndefined();

    vi.stubGlobal("prompt", () => "   ");
    expect(sessionRenameInput(session("s"))).toBeUndefined();
  });
});

describe("isRenamableSession", () => {
  it("allows persisted sessions but excludes archived and temporary sessions", () => {
    expect(isRenamableSession(session("persisted", { persisted: true }))).toBe(true);
    expect(isRenamableSession({ ...session("archived", { persisted: true }), archived: true })).toBe(false);
    expect(isRenamableSession(session("temporary", { persisted: false }))).toBe(false);
  });
});

describe("sessionRowsForCurrentTree", () => {
  it("keeps archived ancestors visible while they have unarchived descendants", () => {
    const parent = { ...session("parent"), archived: true, archivedAt: "2026-06-09T00:00:00.000Z" };
    const child = session("child", { parentSessionPath: parent.path });

    expect(rowSummaries(sessionRowsForCurrentTree([parent, child]))).toEqual([
      { id: "parent", depth: 0, hasMissingParent: false },
      { id: "child", depth: 1, hasMissingParent: false },
    ]);
  });

  it("hides archived parents from the current tree once children are detached", () => {
    const parent = { ...session("parent"), archived: true, archivedAt: "2026-06-09T00:00:00.000Z" };
    const detachedChild = session("child");

    expect(rowSummaries(sessionRowsForCurrentTree([parent, detachedChild]))).toEqual([
      { id: "child", depth: 0, hasMissingParent: false },
    ]);
  });

  it("still marks unavailable parents when the parent record is missing", () => {
    const child = session("child", { parentSessionPath: "/sessions/missing.jsonl" });

    expect(rowSummaries(sessionRowsForCurrentTree([child]))).toEqual([
      { id: "child", depth: 0, hasMissingParent: true },
    ]);
  });

  it("moves a tree with a pinned descendant ahead of newer unpinned trees", () => {
    const newerRoot = session("newer", { modified: "2026-06-10T00:00:00.000Z" });
    const olderRoot = session("older", { modified: "2026-06-09T00:00:00.000Z" });
    const pinnedChild = session("pinned-child", { parentSessionPath: olderRoot.path, modified: "2026-06-08T00:00:00.000Z" });

    expect(rowSummaries(sessionRowsForCurrentTree([newerRoot, olderRoot, pinnedChild], [pinnedChild.id]))).toEqual([
      { id: "older", depth: 0, hasMissingParent: false },
      { id: "pinned-child", depth: 1, hasMissingParent: false },
      { id: "newer", depth: 0, hasMissingParent: false },
    ]);
  });
});

describe("sessionsForSearchResults", () => {
  it("keeps matching session ancestors and archived results in the navigation tree", () => {
    const parent = session("parent");
    const child = session("child", { parentSessionPath: parent.path });
    const archived = { ...session("archived"), archived: true, archivedAt: "2026-06-10T00:00:00.000Z" };

    expect(sessionsForSearchResults([parent, child, archived], [child, archived]).map((candidate) => candidate.id)).toEqual(["parent", "child", "archived"]);
  });
});

function rowSummaries(rows: ReturnType<typeof sessionRowsForCurrentTree>) {
  return rows.map((row) => ({ id: row.session.id, depth: row.depth, hasMissingParent: row.hasMissingParent }));
}

function sessionStatus(sessionId: string, overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...overrides,
  };
}

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/workspace",
    created: "2026-06-09T00:00:00.000Z",
    modified: "2026-06-09T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
    ...overrides,
  };
}

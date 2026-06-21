import type { ClientSession } from "../types.js";
import type { PiAgentSession, PiSessionListEntry } from "./piSessionService.js";
import type { ArchivedSessionRecord, ArchiveSessionInput } from "./sessionArchiveStore.js";
import type { SessionArchiveTreeCandidate } from "./sessionArchiveTree.js";

export interface WorkspaceArchiveCandidate extends SessionArchiveTreeCandidate {
  cwd: string;
  listEntry?: PiSessionListEntry;
  activeSession?: PiAgentSession;
}

export function archiveInputFromListEntry(session: PiSessionListEntry): ArchiveSessionInput {
  return {
    sessionId: session.id,
    cwd: session.cwd,
    path: session.path,
    created: session.created.toISOString(),
    modified: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
    ...(session.name === undefined ? {} : { name: session.name }),
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
  };
}

export function archiveInputFromActiveSession(session: PiAgentSession): ArchiveSessionInput {
  const sessionFile = session.sessionFile;
  if (sessionFile === undefined || sessionFile === "") throw new Error("会话尚未持久化");
  const parentSessionPath = session.sessionManager.getHeader?.()?.parentSession;
  return {
    sessionId: session.sessionId,
    cwd: session.sessionManager.getCwd(),
    path: sessionFile,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    messageCount: session.messages.length,
    firstMessage: "",
    ...(session.sessionName === undefined ? {} : { name: session.sessionName }),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

export function archiveCandidateFromListEntry(session: PiSessionListEntry): WorkspaceArchiveCandidate {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    archived: false,
    listEntry: session,
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
  };
}

export function archiveCandidateFromArchivedRecord(record: ArchivedSessionRecord, fallback: PiSessionListEntry | undefined): WorkspaceArchiveCandidate | undefined {
  const path = record.originalPath ?? fallback?.path;
  if (path === undefined) return undefined;
  const parentSessionPath = record.parentSessionPath ?? fallback?.parentSessionPath;
  return {
    id: record.sessionId,
    path,
    cwd: record.cwd,
    archived: true,
    ...(fallback === undefined ? {} : { listEntry: fallback }),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

export function archiveCandidateFromActiveSession(session: PiAgentSession, archived: boolean): WorkspaceArchiveCandidate {
  const sessionFile = session.sessionFile;
  if (sessionFile === undefined || sessionFile === "") throw new Error("会话尚未持久化");
  const parentSessionPath = session.sessionManager.getHeader?.()?.parentSession;
  return {
    id: session.sessionId,
    path: sessionFile,
    cwd: session.sessionManager.getCwd(),
    archived,
    activeSession: session,
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

export function archiveInputFromCandidate(candidate: WorkspaceArchiveCandidate): ArchiveSessionInput {
  if (candidate.listEntry !== undefined) return archiveInputFromListEntry(candidate.listEntry);
  if (candidate.activeSession !== undefined) return archiveInputFromActiveSession(candidate.activeSession);
  throw new Error(`Session is not available for archiving: ${candidate.id}`);
}

export function clientSessionFromArchivedRecord(record: ArchivedSessionRecord, fallback: PiSessionListEntry | undefined): ClientSession | undefined {
  const path = record.originalPath ?? fallback?.path;
  const created = record.created ?? fallback?.created.toISOString();
  const modified = record.modified ?? fallback?.modified.toISOString();
  const messageCount = record.messageCount ?? fallback?.messageCount;
  const firstMessage = record.firstMessage ?? fallback?.firstMessage;
  if (path === undefined || created === undefined || modified === undefined || messageCount === undefined || firstMessage === undefined) return undefined;
  const name = record.name ?? fallback?.name;
  const parentSessionPath = record.parentSessionPath ?? fallback?.parentSessionPath;
  return {
    id: record.sessionId,
    path,
    cwd: record.cwd,
    ...(name === undefined ? {} : { name }),
    created,
    modified,
    messageCount,
    firstMessage,
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
    archived: true,
    archivedAt: record.archivedAt,
  };
}

export function compareArchivedRecords(a: ArchivedSessionRecord, b: ArchivedSessionRecord): number {
  return archivedTimestamp(b) - archivedTimestamp(a);
}

function archivedTimestamp(record: ArchivedSessionRecord): number {
  const time = Date.parse(record.archivedAt);
  return Number.isNaN(time) ? 0 : time;
}

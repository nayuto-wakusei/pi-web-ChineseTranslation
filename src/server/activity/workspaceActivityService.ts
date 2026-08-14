import { isSessionActive, isWorkspaceActivityActive } from "../../shared/activity.js";
import type { RealtimeEvent, SessionActivity, SessionStatus, TerminalInfo, WorkspaceActivity, WorkspaceActivityResponse } from "../../shared/apiTypes.js";
import { NORMAL_SESSION_EVENT_SCOPE, type SessionEventScope } from "../realtime/sessionEventScope.js";

export interface WorkspaceActivityPublisher {
  publishRealtime(event: RealtimeEvent, scope?: SessionEventScope): void;
}

export interface ActiveWorkspaceActivity {
  cwd: string;
  hasSessionActivity: boolean;
  hasTerminalActivity: boolean;
}

interface SessionRecord {
  cwd: string;
  status?: SessionStatus;
  activity?: SessionActivity;
}

interface TerminalRecord {
  cwd: string;
}

export class WorkspaceActivityService {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly terminals = new Map<string, TerminalRecord>();

  constructor(
    private readonly publisher?: WorkspaceActivityPublisher,
    private readonly onChanged?: (scope: SessionEventScope) => void,
  ) {}

  /** Activity projection consumed by the daemon-owned machine status tree. */
  activeSnapshot(scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): { workspaces: readonly ActiveWorkspaceActivity[] } {
    return { workspaces: this.activeCwds(scope).map((cwd) => this.summaryForCwd(cwd, scope)) };
  }

  applySessionStatus(cwd: string, status: SessionStatus, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const key = scopedKey(status.sessionId, scope);
    const previousCwd = this.sessions.get(key)?.cwd;
    const record = this.sessions.get(key) ?? { cwd };
    record.cwd = cwd;
    record.status = status;
    if (!isSessionActive(status) && record.activity?.phase === "active") delete record.activity;
    this.sessions.set(key, record);
    this.pruneIdleSession(status.sessionId, scope);
    this.publishChangedCwds(previousCwd, cwd, scope);
  }

  applySessionActivity(cwd: string, activity: SessionActivity, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const key = scopedKey(activity.sessionId, scope);
    const previousCwd = this.sessions.get(key)?.cwd;
    const record = this.sessions.get(key) ?? { cwd };
    record.cwd = cwd;
    record.activity = activity;
    this.sessions.set(key, record);
    this.pruneIdleSession(activity.sessionId, scope);
    this.publishChangedCwds(previousCwd, cwd, scope);
  }

  removeSession(sessionId: string, cwd?: string, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const key = scopedKey(sessionId, scope);
    const previousCwd = this.sessions.get(key)?.cwd ?? cwd;
    this.sessions.delete(key);
    this.publishCwd(previousCwd, scope);
  }

  reconcileSessionActivity(cwd: string, sessionIds: Iterable<string>, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const knownSessionIds = new Set(sessionIds);
    let changed = false;
    for (const [key, record] of this.sessions.entries()) {
      const { id, scope: recordScope } = unscopedKey(key);
      if (recordScope !== scope) continue;
      const sessionId = id;
      if (record.cwd !== cwd || knownSessionIds.has(sessionId)) continue;
      this.sessions.delete(key);
      changed = true;
    }
    if (changed) this.publishCwd(cwd, scope);
  }

  updateTerminal(terminal: Pick<TerminalInfo, "id" | "cwd" | "exited">, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const key = scopedKey(terminal.id, scope);
    const previousCwd = this.terminals.get(key)?.cwd;
    if (terminal.exited) this.terminals.delete(key);
    else this.terminals.set(key, { cwd: terminal.cwd });
    this.publishChangedCwds(previousCwd, terminal.cwd, scope);
  }

  removeTerminal(terminalId: string, cwd?: string, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const key = scopedKey(terminalId, scope);
    const previousCwd = this.terminals.get(key)?.cwd ?? cwd;
    this.terminals.delete(key);
    this.publishCwd(previousCwd, scope);
  }

  snapshot(scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): WorkspaceActivityResponse {
    return {
      workspaces: this.activeCwds(scope).map((cwd) => this.summaryForCwd(cwd, scope)).filter(isWorkspaceActivityActive),
      generatedAt: new Date().toISOString(),
    };
  }

  private pruneIdleSession(sessionId: string, scope: SessionEventScope): void {
    const key = scopedKey(sessionId, scope);
    const record = this.sessions.get(key);
    if (record !== undefined && !isSessionActive(record.status, record.activity)) this.sessions.delete(key);
  }

  private publishChangedCwds(previousCwd: string | undefined, cwd: string, scope: SessionEventScope): void {
    this.publishCwd(previousCwd, scope);
    if (previousCwd !== cwd) this.publishCwd(cwd, scope);
  }

  private publishCwd(cwd: string | undefined, scope: SessionEventScope): void {
    if (cwd === undefined || cwd === "") return;
    this.onChanged?.(scope);
    this.publisher?.publishRealtime({ type: "workspace.activity", activity: this.summaryForCwd(cwd, scope) }, scope);
  }

  private activeCwds(scope: SessionEventScope): string[] {
    const cwds = new Set<string>();
    for (const [key, record] of this.sessions.entries()) {
      if (unscopedKey(key).scope !== scope) continue;
      if (isSessionActive(record.status, record.activity)) cwds.add(record.cwd);
    }
    for (const [key, record] of this.terminals.entries()) {
      if (unscopedKey(key).scope === scope) cwds.add(record.cwd);
    }
    return [...cwds].sort((a, b) => a.localeCompare(b));
  }

  private summaryForCwd(cwd: string, scope: SessionEventScope): WorkspaceActivity {
    return {
      cwd,
      hasSessionActivity: [...this.sessions.entries()].some(([key, record]) => unscopedKey(key).scope === scope && record.cwd === cwd && isSessionActive(record.status, record.activity)),
      hasTerminalActivity: [...this.terminals.entries()].some(([key, terminal]) => unscopedKey(key).scope === scope && terminal.cwd === cwd),
      updatedAt: new Date().toISOString(),
    };
  }
}

function scopedKey(id: string, scope: SessionEventScope): string {
  return `${scope}\0${id}`;
}

function unscopedKey(key: string): { scope: SessionEventScope; id: string } {
  const separator = key.indexOf("\0");
  if (separator === -1) return { scope: NORMAL_SESSION_EVENT_SCOPE, id: key };
  return { scope: key.slice(0, separator), id: key.slice(separator + 1) };
}

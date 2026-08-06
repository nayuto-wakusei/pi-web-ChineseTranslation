import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { piWebDataDir } from "../../config.js";

export type NormalToolAuditStatus = "started" | "completed" | "failed" | "interrupted";

export interface NormalToolAuditEvent {
  sessionId: string;
  cwd: string;
  toolName: string;
  toolCallId: string;
  status: "started" | "completed" | "failed";
}

export interface NormalToolAuditRow {
  id: number;
  sessionId: string;
  cwd: string;
  toolName: string;
  toolCallId: string;
  status: NormalToolAuditStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  createdAt: string;
}

export interface NormalToolAuditQuery {
  since?: Date;
  status?: NormalToolAuditStatus;
  sessionId?: string;
  toolName?: string;
  limit?: number;
}

export interface NormalToolAuditStats {
  total: number;
  byStatus: Record<NormalToolAuditStatus, number>;
  byTool: { toolName: string; count: number }[];
}

export interface NormalToolAuditStoreOptions {
  path: string;
  retentionDays: number;
  maxRows: number;
  now?: () => Date;
  maintenanceIntervalMs?: number;
  onError?: (error: unknown) => void;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAINTENANCE_INTERVAL_MS = DAY_MS;

export function normalToolAuditDatabasePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "audit", "normal-tool-calls.sqlite");
}

export class NormalToolAuditStore {
  private readonly database: DatabaseSync;
  private readonly now: () => Date;
  private readonly pending = new Map<string, number>();
  private readonly maintenanceTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: NormalToolAuditStoreOptions) {
    this.now = options.now ?? (() => new Date());
    this.database = openWritableDatabase(options.path);
    const now = this.now();
    markIncompleteCallsInterrupted(this.database, now);
    pruneDatabase(this.database, retentionCutoff(now, options.retentionDays), options.maxRows);
    const interval = options.maintenanceIntervalMs ?? DEFAULT_MAINTENANCE_INTERVAL_MS;
    if (interval > 0) {
      this.maintenanceTimer = setInterval(() => {
        try {
          this.maintain();
        } catch (error) {
          options.onError?.(error);
        }
      }, interval);
      this.maintenanceTimer.unref();
    }
  }

  record(event: NormalToolAuditEvent): void {
    const now = this.now();
    const key = pendingKey(event.sessionId, event.toolCallId);
    if (event.status === "started") {
      const priorId = this.pending.get(key);
      if (priorId !== undefined) markRowsInterrupted(this.database, [priorId], now);
      const result = this.database.prepare(`
        INSERT INTO normal_tool_calls (
          session_id, cwd, tool_name, tool_call_id, status, started_at_ms, created_at_ms
        ) VALUES (?, ?, ?, ?, 'started', ?, ?)
      `).run(event.sessionId, event.cwd, event.toolName, event.toolCallId, now.getTime(), now.getTime());
      this.pending.set(key, Number(result.lastInsertRowid));
      return;
    }

    const pendingId = this.pending.get(key);
    this.pending.delete(key);
    if (pendingId !== undefined) {
      this.database.prepare(`
        UPDATE normal_tool_calls
        SET status = ?, finished_at_ms = ?, duration_ms = MAX(0, ? - started_at_ms)
        WHERE id = ?
      `).run(event.status, now.getTime(), now.getTime(), pendingId);
      return;
    }

    this.database.prepare(`
      INSERT INTO normal_tool_calls (
        session_id, cwd, tool_name, tool_call_id, status, started_at_ms, finished_at_ms, duration_ms, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(event.sessionId, event.cwd, event.toolName, event.toolCallId, event.status, now.getTime(), now.getTime(), now.getTime());
  }

  maintain(): void {
    const now = this.now();
    pruneDatabase(this.database, retentionCutoff(now, this.options.retentionDays), this.options.maxRows);
  }

  close(): void {
    if (this.maintenanceTimer !== undefined) clearInterval(this.maintenanceTimer);
    markRowsInterrupted(this.database, [...this.pending.values()], this.now());
    this.pending.clear();
    this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.database.close();
  }
}

export function queryNormalToolAudit(path: string, query: NormalToolAuditQuery = {}): NormalToolAuditRow[] {
  if (!existsSync(path)) return [];
  return withDatabase(path, true, (database) => {
    const clauses: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (query.since !== undefined) { clauses.push("started_at_ms >= ?"); parameters.push(query.since.getTime()); }
    if (query.status !== undefined) { clauses.push("status = ?"); parameters.push(query.status); }
    if (query.sessionId !== undefined) { clauses.push("session_id = ?"); parameters.push(query.sessionId); }
    if (query.toolName !== undefined) { clauses.push("tool_name = ?"); parameters.push(query.toolName); }
    const limit = Math.max(1, Math.min(query.limit ?? 100, 10_000));
    parameters.push(limit);
    const rows = database.prepare(`
      SELECT id, session_id, cwd, tool_name, tool_call_id, status,
             started_at_ms, finished_at_ms, duration_ms, created_at_ms
      FROM normal_tool_calls
      ${clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`}
      ORDER BY started_at_ms DESC, id DESC
      LIMIT ?
    `).all(...parameters);
    return rows.map(normalToolAuditRow);
  });
}

export function normalToolAuditStats(path: string, since?: Date): NormalToolAuditStats {
  const empty = (): NormalToolAuditStats => ({ total: 0, byStatus: { started: 0, completed: 0, failed: 0, interrupted: 0 }, byTool: [] });
  if (!existsSync(path)) return empty();
  return withDatabase(path, true, (database) => {
    const where = since === undefined ? "" : "WHERE started_at_ms >= ?";
    const parameters = since === undefined ? [] : [since.getTime()];
    const statusRows = database.prepare(`SELECT status, COUNT(*) AS count FROM normal_tool_calls ${where} GROUP BY status`).all(...parameters);
    const toolRows = database.prepare(`SELECT tool_name, COUNT(*) AS count FROM normal_tool_calls ${where} GROUP BY tool_name ORDER BY count DESC, tool_name ASC`).all(...parameters);
    const result = empty();
    for (const row of statusRows) {
      const status = auditStatus(row["status"]);
      const count = outputNumber(row["count"], "count");
      result.byStatus[status] = count;
      result.total += count;
    }
    result.byTool = toolRows.map((row) => ({ toolName: outputString(row["tool_name"], "tool_name"), count: outputNumber(row["count"], "count") }));
    return result;
  });
}

export function pruneNormalToolAudit(path: string, before: Date, maxRows: number): number {
  if (!existsSync(path)) return 0;
  return withDatabase(path, false, (database) => pruneDatabase(database, before, maxRows));
}

export function vacuumNormalToolAudit(path: string): void {
  if (!existsSync(path)) return;
  withDatabase(path, false, (database) => {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    database.exec("VACUUM");
  });
}

function openWritableDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path);
  try {
    if (process.platform !== "win32") chmodSync(path, 0o600);
    initializeDatabase(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function initializeDatabase(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA busy_timeout = 5000");
  const version = outputNumber(database.prepare("PRAGMA user_version").get()?.["user_version"], "user_version");
  if (version > 1) throw new Error(`Normal tool audit database schema version ${String(version)} is newer than this PI WEB build`);
  database.exec(`
    CREATE TABLE IF NOT EXISTS normal_tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'interrupted')),
      started_at_ms INTEGER NOT NULL,
      finished_at_ms INTEGER,
      duration_ms INTEGER,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS normal_tool_calls_started_idx ON normal_tool_calls(started_at_ms DESC);
    CREATE INDEX IF NOT EXISTS normal_tool_calls_session_idx ON normal_tool_calls(session_id, started_at_ms DESC);
    CREATE INDEX IF NOT EXISTS normal_tool_calls_tool_idx ON normal_tool_calls(tool_name, started_at_ms DESC);
  `);
  if (version === 0) database.exec("PRAGMA user_version = 1");
}

function withDatabase<T>(path: string, readOnly: boolean, use: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(path, { readOnly });
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    return use(database);
  } finally {
    database.close();
  }
}

function markIncompleteCallsInterrupted(database: DatabaseSync, now: Date): void {
  database.prepare(`
    UPDATE normal_tool_calls
    SET status = 'interrupted', finished_at_ms = ?, duration_ms = MAX(0, ? - started_at_ms)
    WHERE status = 'started'
  `).run(now.getTime(), now.getTime());
}

function markRowsInterrupted(database: DatabaseSync, ids: number[], now: Date): void {
  if (ids.length === 0) return;
  const statement = database.prepare(`
    UPDATE normal_tool_calls
    SET status = 'interrupted', finished_at_ms = ?, duration_ms = MAX(0, ? - started_at_ms)
    WHERE id = ? AND status = 'started'
  `);
  for (const id of ids) statement.run(now.getTime(), now.getTime(), id);
}

function pruneDatabase(database: DatabaseSync, before: Date, maxRows: number): number {
  const expired = database.prepare("DELETE FROM normal_tool_calls WHERE started_at_ms < ?").run(before.getTime()).changes;
  const excess = database.prepare(`
    DELETE FROM normal_tool_calls
    WHERE id IN (
      SELECT id FROM normal_tool_calls ORDER BY started_at_ms DESC, id DESC LIMIT -1 OFFSET ?
    )
  `).run(maxRows).changes;
  database.exec("PRAGMA wal_checkpoint(PASSIVE)");
  return Number(expired) + Number(excess);
}

function retentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

function pendingKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}\0${toolCallId}`;
}

function normalToolAuditRow(row: Record<string, SQLOutputValue>): NormalToolAuditRow {
  const finishedAt = optionalOutputNumber(row["finished_at_ms"], "finished_at_ms");
  const durationMs = optionalOutputNumber(row["duration_ms"], "duration_ms");
  return {
    id: outputNumber(row["id"], "id"),
    sessionId: outputString(row["session_id"], "session_id"),
    cwd: outputString(row["cwd"], "cwd"),
    toolName: outputString(row["tool_name"], "tool_name"),
    toolCallId: outputString(row["tool_call_id"], "tool_call_id"),
    status: auditStatus(row["status"]),
    startedAt: new Date(outputNumber(row["started_at_ms"], "started_at_ms")).toISOString(),
    ...(finishedAt === undefined ? {} : { finishedAt: new Date(finishedAt).toISOString() }),
    ...(durationMs === undefined ? {} : { durationMs }),
    createdAt: new Date(outputNumber(row["created_at_ms"], "created_at_ms")).toISOString(),
  };
}

function auditStatus(value: SQLOutputValue | undefined): NormalToolAuditStatus {
  if (value === "started" || value === "completed" || value === "failed" || value === "interrupted") return value;
  throw new Error("Normal tool audit database contains an invalid status");
}

function outputString(value: SQLOutputValue | undefined, field: string): string {
  if (typeof value !== "string") throw new Error(`Normal tool audit database ${field} is invalid`);
  return value;
}

function outputNumber(value: SQLOutputValue | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`Normal tool audit database ${field} is invalid`);
  return value;
}

function optionalOutputNumber(value: SQLOutputValue | undefined, field: string): number | undefined {
  return value === null || value === undefined ? undefined : outputNumber(value, field);
}

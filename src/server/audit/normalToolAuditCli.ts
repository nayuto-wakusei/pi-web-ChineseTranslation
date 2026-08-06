import { writeFileSync } from "node:fs";
import { DEFAULT_NORMAL_TOOL_AUDIT_MAX_ROWS, effectivePiWebConfig } from "../../config.js";
import {
  normalToolAuditDatabasePath,
  normalToolAuditStats,
  pruneNormalToolAudit,
  queryNormalToolAudit,
  vacuumNormalToolAudit,
  type NormalToolAuditQuery,
  type NormalToolAuditRow,
  type NormalToolAuditStatus,
} from "./normalToolAuditStore.js";

export interface NormalToolAuditCliOptions {
  databasePath?: string;
  now?: () => Date;
  stdout?: (text: string) => void;
  writeOutput?: (path: string, content: string) => void;
  maxRows?: number;
}

export function runNormalToolAuditCommand(args: string[], options: NormalToolAuditCliOptions = {}): void {
  const [subcommand, ...optionArgs] = args;
  if (subcommand === undefined || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    (options.stdout ?? console.log)(normalToolAuditHelp());
    return;
  }
  const values = parseOptions(optionArgs);
  const path = options.databasePath ?? normalToolAuditDatabasePath();
  const now = options.now?.() ?? new Date();
  const stdout = options.stdout ?? console.log;

  if (subcommand === "list") {
    requireAllowedOptions(values, ["since", "status", "session", "tool", "limit"]);
    for (const row of queryNormalToolAudit(path, auditQuery(values, now))) stdout(JSON.stringify(row));
    return;
  }
  if (subcommand === "stats") {
    requireAllowedOptions(values, ["since"]);
    stdout(JSON.stringify(normalToolAuditStats(path, optionalBoundary(values.get("since"), now)), null, 2));
    return;
  }
  if (subcommand === "export") {
    requireAllowedOptions(values, ["since", "status", "session", "tool", "limit", "format", "output"]);
    const format = values.get("format") ?? "jsonl";
    if (format !== "jsonl" && format !== "csv") throw new Error("--format must be jsonl or csv");
    const output = requiredOption(values, "output");
    const rows = queryNormalToolAudit(path, auditQuery(values, now, 10_000));
    (options.writeOutput ?? ((target, content) => { writeFileSync(target, content, "utf8"); }))(output, format === "csv" ? rowsCsv(rows) : rowsJsonl(rows));
    stdout(`Exported ${String(rows.length)} audit rows to ${output}`);
    return;
  }
  if (subcommand === "prune") {
    requireAllowedOptions(values, ["before"]);
    const before = parseBoundary(requiredOption(values, "before"), now);
    const maxRows = options.maxRows ?? effectivePiWebConfig().config.auditLog?.normalMode?.maxRows ?? DEFAULT_NORMAL_TOOL_AUDIT_MAX_ROWS;
    stdout(`Deleted ${String(pruneNormalToolAudit(path, before, maxRows))} audit rows`);
    return;
  }
  if (subcommand === "vacuum") {
    requireAllowedOptions(values, []);
    vacuumNormalToolAudit(path);
    stdout("Audit database vacuum completed");
    return;
  }
  throw new Error(`Unknown audit command: ${subcommand}`);
}

export function normalToolAuditHelp(): string {
  return `PI WEB ordinary-mode tool audit

Usage:
  pi-web audit list [--since 24h] [--status failed] [--session ID] [--tool NAME] [--limit 100]
  pi-web audit stats [--since 30d]
  pi-web audit export --output FILE [--format jsonl|csv] [--since 30d] [--status STATUS] [--session ID] [--tool NAME] [--limit 10000]
  pi-web audit prune --before DATE
  pi-web audit vacuum`;
}

function parseOptions(args: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined || !argument.startsWith("--") || argument.length === 2) throw new Error(`Unexpected audit argument: ${argument ?? ""}`);
    const name = argument.slice(2);
    if (values.has(name)) throw new Error(`Audit option --${name} was provided more than once`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Audit option --${name} requires a value`);
    values.set(name, value);
    index += 1;
  }
  return values;
}

function requireAllowedOptions(values: Map<string, string>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = [...values.keys()].find((key) => !allowedSet.has(key));
  if (unknown !== undefined) throw new Error(`Audit command does not support --${unknown}`);
}

function auditQuery(values: Map<string, string>, now: Date, defaultLimit = 100): NormalToolAuditQuery {
  const status = values.get("status");
  return {
    ...(values.get("since") === undefined ? {} : { since: parseBoundary(requiredOption(values, "since"), now) }),
    ...(status === undefined ? {} : { status: parseStatus(status) }),
    ...(values.get("session") === undefined ? {} : { sessionId: requiredOption(values, "session") }),
    ...(values.get("tool") === undefined ? {} : { toolName: requiredOption(values, "tool") }),
    limit: values.get("limit") === undefined ? defaultLimit : positiveInteger(requiredOption(values, "limit"), "--limit"),
  };
}

function optionalBoundary(value: string | undefined, now: Date): Date | undefined {
  return value === undefined ? undefined : parseBoundary(value, now);
}

function parseBoundary(value: string, now: Date): Date {
  const duration = /^(\d+)(m|h|d)$/u.exec(value);
  if (duration !== null) {
    const amount = positiveInteger(duration[1] ?? "", "time range");
    const unit = duration[2];
    const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return new Date(now.getTime() - amount * multiplier);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid audit time boundary: ${value}`);
  return parsed;
}

function parseStatus(value: string): NormalToolAuditStatus {
  if (value === "started" || value === "completed" || value === "failed" || value === "interrupted") return value;
  throw new Error("--status must be started, completed, failed, or interrupted");
}

function positiveInteger(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

function requiredOption(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined || value === "") throw new Error(`Audit option --${name} is required`);
  return value;
}

function rowsJsonl(rows: NormalToolAuditRow[]): string {
  return rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function rowsCsv(rows: NormalToolAuditRow[]): string {
  const fields: (keyof NormalToolAuditRow)[] = ["id", "sessionId", "cwd", "toolName", "toolCallId", "status", "startedAt", "finishedAt", "durationMs", "createdAt"];
  const lines = [fields.join(",")];
  for (const row of rows) lines.push(fields.map((field) => csvCell(row[field])).join(","));
  return `${lines.join("\n")}\n`;
}

function csvCell(value: unknown): string {
  if (value !== undefined && typeof value !== "string" && typeof value !== "number") throw new Error("Audit CSV contains an invalid value");
  const text = value === undefined ? "" : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

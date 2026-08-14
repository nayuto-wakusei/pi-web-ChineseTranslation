/**
 * Claims exclusive ownership of the session daemon data directory.
 */

import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { piWebDataDir } from "../../config.js";
import { sessiondEndpointDescription } from "../../sessiond/config.js";

export const SESSIOND_OWNER_MARKER_FILENAME = "sessiond-owner.json";

export interface SessiondStateOwnershipRecord {
  readonly pid: number;
  readonly startedAt: string;
  readonly processStartTime?: string;
  readonly endpoint: string;
}

export class SessiondStateOwnershipConflictError extends Error {
  readonly dataDir: string;
  readonly owner: SessiondStateOwnershipRecord;

  constructor(options: { dataDir: string; markerPath: string; owner: SessiondStateOwnershipRecord }) {
    const { dataDir, markerPath, owner } = options;
    super(
      `another pi-web session daemon already owns this state\n\n` +
        `The data directory "${dataDir}" is owned by pid ${String(owner.pid)}, started ${owner.startedAt}, listening on ${owner.endpoint}. ` +
        `Use a different PI_WEB_DATA_DIR and session daemon/web endpoint for a second instance, or remove the stale marker ${markerPath}.`,
    );
    this.name = "SessiondStateOwnershipConflictError";
    this.dataDir = dataDir;
    this.owner = owner;
  }
}

export interface SessiondStateOwnershipLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
}

export interface ClaimSessiondStateOwnershipOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly dataDir?: string;
  readonly ownPid?: number;
  readonly isAlive?: (record: SessiondStateOwnershipRecord) => boolean;
  readonly graceMs?: number;
  readonly pollIntervalMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly logger?: SessiondStateOwnershipLogger;
}

export interface SessiondStateOwnership {
  readonly markerPath: string;
  readonly record: SessiondStateOwnershipRecord;
  release(): Promise<void>;
}

const DEFAULT_GRACE_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export async function claimSessiondStateOwnership(options: ClaimSessiondStateOwnershipOptions): Promise<SessiondStateOwnership> {
  const ownPid = options.ownPid ?? process.pid;
  const isAlive = options.isAlive ?? isOwnershipRecordAlive;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const logger = options.logger;
  const dataDir = options.dataDir ?? piWebDataDir(options.env);
  const markerPath = join(dataDir, SESSIOND_OWNER_MARKER_FILENAME);
  const processStartTime = readProcessStartTime(ownPid);
  const record: SessiondStateOwnershipRecord = {
    pid: ownPid,
    startedAt: new Date().toISOString(),
    ...(processStartTime === undefined ? {} : { processStartTime }),
    endpoint: sessiondEndpointDescription(options.env),
  };
  await mkdir(dataDir, { recursive: true });
  const deadline = Date.now() + graceMs;
  for (;;) {
    const existing = await readOwnershipRecord(markerPath);
    if (existing !== undefined && existing !== "invalid") {
      if (existing.pid !== ownPid && isAlive(existing)) {
        if (Date.now() >= deadline) throw new SessiondStateOwnershipConflictError({ dataDir, markerPath, owner: existing });
        logger?.warn({ markerPath, owner: existing }, "another live session daemon owns this state; waiting for release");
        await sleep(pollIntervalMs);
        continue;
      }
      if (existing.pid !== ownPid) logger?.info({ markerPath, previousOwner: existing }, "taking over stale session daemon ownership marker");
      await rm(markerPath, { force: true });
    } else if (existing === "invalid") {
      if (Date.now() < deadline) {
        await sleep(pollIntervalMs);
        continue;
      }
      logger?.warn({ markerPath }, "discarding invalid session daemon ownership marker");
      await rm(markerPath, { force: true });
    }
    try {
      await writeFile(markerPath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
      return { markerPath, record, release: () => releaseOwnershipMarker(markerPath, record, logger) };
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
    }
  }
}

export function parseOwnershipRecord(content: string): SessiondStateOwnershipRecord | "invalid" {
  try {
    const value: unknown = JSON.parse(content);
    if (!isRecord(value) || typeof value["pid"] !== "number" || typeof value["startedAt"] !== "string" || typeof value["endpoint"] !== "string") return "invalid";
    if (value["processStartTime"] !== undefined && typeof value["processStartTime"] !== "string") return "invalid";
    return {
      pid: value["pid"],
      startedAt: value["startedAt"],
      ...(value["processStartTime"] === undefined ? {} : { processStartTime: value["processStartTime"] }),
      endpoint: value["endpoint"],
    };
  } catch {
    return "invalid";
  }
}

export function isOwnershipRecordAlive(record: Pick<SessiondStateOwnershipRecord, "pid" | "processStartTime">): boolean {
  const currentStartTime = readProcessStartTime(record.pid);
  if (currentStartTime !== undefined && record.processStartTime !== undefined) return currentStartTime === record.processStartTime;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error) {
    return isErrorCode(error, "EPERM");
  }
}

export function readProcessStartTime(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    return closeParen === -1 ? undefined : stat.slice(closeParen + 2).split(" ")[19];
  } catch {
    return undefined;
  }
}

async function readOwnershipRecord(markerPath: string): Promise<SessiondStateOwnershipRecord | "invalid" | undefined> {
  try {
    return parseOwnershipRecord(await readFile(markerPath, "utf8"));
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function releaseOwnershipMarker(markerPath: string, record: SessiondStateOwnershipRecord, logger: SessiondStateOwnershipLogger | undefined): Promise<void> {
  try {
    const current = await readOwnershipRecord(markerPath);
    if (current !== undefined && current !== "invalid" && current.pid === record.pid && current.startedAt === record.startedAt) await rm(markerPath, { force: true });
  } catch (error) {
    logger?.warn({ err: error, markerPath }, "could not release the session daemon ownership marker");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}

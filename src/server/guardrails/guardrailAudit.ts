import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { piWebDataDir } from "../../config.js";
import { isRecord } from "../../shared/piWebConfigParsing.js";

export type GuardrailStage = "user_input" | "external_text" | "before_tool";
export type GuardrailAction = "allow" | "block" | "isolate" | "error" | "shadow_hit" | "review";

export interface GuardrailEvent {
  eventId: string;
  occurredAt: string;
  source: "pi_management_embed";
  stage: GuardrailStage;
  action: GuardrailAction;
  schemaVersion: 2;
  reasonCode?: string;
  policyVersion?: string;
  projectId?: string;
  sessionId?: string;
  turnId?: string;
  toolCallId?: string;
  traceId?: string;
  actorId?: string;
  actorName?: string;
  actorRoles?: string[];
  projectName?: string;
  detectorVersion?: string;
  latencyMs?: number;
  origin?: string;
  layer?: string;
  tool?: string;
  ruleId?: string;
  mode?: "enforce" | "shadow";
  verdict?: "risk" | "review" | "error";
  disposition?: "blocked" | "isolated" | "paused" | "unavailable" | "shadow_allowed";
  execution?: "not_dispatched" | "unknown";
  labels?: string[];
  window?: number;
  matchStart?: number;
  matchEnd?: number;
  originalLength?: number;
  truncated?: boolean;
  materialRef?: string;
  task?: string;
  evidence?: string;
}

/** Only redacted wire events are persisted. Delivery can repeat after a lost acknowledgement. */
export class GuardrailOutbox {
  private readonly db: DatabaseSync;
  private timer?: ReturnType<typeof setTimeout>;
  private nextWake = Infinity;
  private nextSweep = 0;
  private busy = false;
  private stopped = false;
  private retryMs = 1000;

  constructor(private readonly env: NodeJS.ProcessEnv) {
    const directory = join(piWebDataDir(env), "guardrails");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "pending.sqlite"));
    this.db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS retry_later (id TEXT PRIMARY KEY, due INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS hourly (bucket TEXT,stage TEXT,project TEXT,count INTEGER NOT NULL, PRIMARY KEY(bucket,stage,project)); CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, event TEXT NOT NULL)",
    );
    this.schedule(10);
  }

  append(event: GuardrailEvent): void {
    if (event.action === "allow") {
      const bucket = event.occurredAt.slice(0, 13) + ":00:00.000Z";
      this.db
        .prepare("INSERT INTO hourly VALUES (?,?,?,1) ON CONFLICT(bucket,stage,project) DO UPDATE SET count=count+1")
        .run(bucket, event.stage, event.projectId ?? "");
    } else {
      this.db.prepare("INSERT INTO pending (id,event) VALUES (?,?)").run(event.eventId, JSON.stringify(event));
    }
    if (event.action !== "allow" && this.retryMs === 1000) this.schedule(10);
  }

  private prepareDelivery(): void {
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
    const hour = new Date().toISOString().slice(0, 13) + ":00:00.000Z";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (Date.now() >= this.nextSweep) {
        this.db.prepare("DELETE FROM pending WHERE json_extract(event,'$.occurredAt') <= ?").run(cutoff);
        this.db.exec("DELETE FROM retry_later WHERE id NOT IN (SELECT id FROM pending)");
        this.db.prepare("DELETE FROM hourly WHERE bucket <= ?").run(cutoff);
      }
      for (const row of this.db.prepare("SELECT * FROM hourly WHERE bucket < ? LIMIT 256").all(hour)) {
        const bucket = String(row["bucket"]);
        const stage = String(row["stage"]);
        const project = String(row["project"]);
        const eventId = randomUUID();
        const batch = {
          schemaVersion: 2,
          source: "pi_management_embed",
          action: "allow",
          eventId,
          occurredAt: bucket,
          stage,
          projectId: project === "" ? undefined : project,
          count: row["count"],
        };
        this.db.prepare("INSERT INTO pending VALUES (?,?)").run(eventId, JSON.stringify(batch));
        this.db.prepare("DELETE FROM hourly WHERE bucket=? AND stage=? AND project=?").run(bucket, stage, project);
      }
      this.db.exec("COMMIT");
      if (Date.now() >= this.nextSweep) this.nextSweep = Date.now() + 3600_000;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.db.close();
  }

  private schedule(ms: number): void {
    if (this.stopped || this.busy || this.nextWake <= Date.now() + ms) return;
    clearTimeout(this.timer);
    this.nextWake = Date.now() + ms;
    this.timer = setTimeout(() => {
      delete this.timer;
      this.nextWake = Infinity;
      void this.drain();
    }, ms);
    this.timer.unref();
  }

  private isStopped(): boolean {
    return this.stopped;
  }

  private async drain(): Promise<void> {
    this.busy = true;
    let nextDelay = 60_000;
    try {
      this.prepareDelivery();
      const ready = " FROM pending WHERE id NOT IN (SELECT id FROM retry_later WHERE due>?)";
      const rows = this.db.prepare("SELECT id,event" + ready + " ORDER BY rowid LIMIT 64").all(Date.now());
      for (const row of rows) {
        const rowBody = String(row["event"]);
        const payload: unknown = JSON.parse(rowBody);
        if (isRecord(payload) && typeof payload["occurredAt"] === "string" && Date.parse(payload["occurredAt"]) <= Date.now() - 90*86400_000) {
          this.db.prepare("DELETE FROM pending WHERE id=?").run(String(row["id"]));
          continue;
        }
        const url = this.env["PI_GUARDRAIL_AUDIT_URL"];
        const token = this.env["GUARDRAIL_AUDIT_TOKEN"];
        if (url === undefined || url === "" || token === undefined || token === "")
          throw new Error("Audit sink unavailable");
        const response = await fetch(url, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(3000),
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: rowBody,
        });
        if (this.isStopped()) return;
        if (response.status === 400 || response.status === 409 || response.status === 413) {
          await response.body?.cancel();
          if (this.isStopped()) return;
          this.db
            .prepare("INSERT OR REPLACE INTO retry_later VALUES (?,?)")
            .run(String(row["id"]), Date.now() + 3600_000);
          process.emitWarning("Guardrail audit item rejected; retained for redelivery");
          continue;
        }
        const ack: unknown = await response.json();
        if (!response.ok || !isRecord(ack) || ack["accepted"] !== true) throw new Error("Audit not acknowledged");
        if (this.isStopped()) return;
        this.db.prepare("DELETE FROM pending WHERE id=?").run(String(row["id"]));
      }
      this.retryMs = 1000;
      // Also discover rows appended while delivery was in progress.
      if (this.db.prepare("SELECT 1" + ready + " LIMIT 1").get(Date.now())) nextDelay = 10;
    } catch {
      if (this.retryMs === 1000) process.emitWarning("Guardrail audit delivery pending; the daemon will retry");
      nextDelay = this.retryMs;
      this.retryMs = Math.min(60_000, this.retryMs * 2);
    } finally {
      this.busy = false;
      if (nextDelay > 0) this.schedule(nextDelay);
    }
  }
}

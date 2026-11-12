import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { piWebDataDir } from "../../config.js";
import { isRecord } from "../../shared/piWebConfigParsing.js";

export type GuardrailStage = "user_input" | "external_text" | "before_tool";
export type GuardrailAction = "allow" | "block" | "isolate" | "error" | "shadow_hit";

export interface GuardrailEvent {
  eventId: string;
  occurredAt: string;
  source: "pi_management_embed";
  stage: GuardrailStage;
  action: GuardrailAction;
  reasonCode: string;
  policyVersion: string;
  detectorVersion?: string;
  projectId?: string;
  sessionId?: string;
  turnId?: string;
  latencyMs?: number;
}

export function auditIdentifier(value: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  const key = env["GUARDRAIL_AUDIT_TOKEN"];
  return value !== undefined && value !== "" && key !== undefined && key !== "" ? createHmac("sha256", key).update(value).digest("hex") : undefined;
}

/** Only redacted wire events are persisted. Delivery can repeat after a lost acknowledgement. */
export class GuardrailOutbox {
  private readonly db: DatabaseSync;
  private timer?: ReturnType<typeof setTimeout>;
  private busy = false;
  private stopped = false;
  private retryMs = 1000;

  constructor(private readonly env: NodeJS.ProcessEnv) {
    const directory = join(piWebDataDir(env), "guardrails");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "pending.sqlite"));
    this.db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, event TEXT NOT NULL)");
    this.schedule(10);
  }

  append(event: GuardrailEvent): void {
    this.db.prepare("INSERT OR IGNORE INTO pending (id,event) VALUES (?,?)").run(event.eventId, JSON.stringify(event));
    this.schedule(10);
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.db.close();
  }

  private schedule(ms: number): void {
    if (this.stopped || this.busy || this.timer !== undefined) return;
    this.timer = setTimeout(() => { delete this.timer; void this.drain(); }, ms);
    this.timer.unref();
  }

  private async drain(): Promise<void> {
    this.busy = true;
    let nextDelay = 0;
    try {
      const rows = this.db.prepare("SELECT id,event FROM pending ORDER BY rowid LIMIT 64").all();
      for (const row of rows) {
        const url = this.env["PI_GUARDRAIL_AUDIT_URL"];
        const token = this.env["GUARDRAIL_AUDIT_TOKEN"];
        if (url === undefined || url === "" || token === undefined || token === "") throw new Error("Audit sink unavailable");
        const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(3000),
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: String(row["event"]) });
        const ack: unknown = await response.json();
        if (!response.ok || !isRecord(ack) || ack["accepted"] !== true) throw new Error("Audit not acknowledged");
        if (this.stopped) return;
        this.db.prepare("DELETE FROM pending WHERE id=?").run(String(row["id"]));
      }
      this.retryMs = 1000;
      // Also discover rows appended while delivery was in progress.
      if (this.db.prepare("SELECT 1 FROM pending LIMIT 1").get()) nextDelay = 10;
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

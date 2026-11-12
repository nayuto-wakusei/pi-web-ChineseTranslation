import { createHash } from "node:crypto";
import { isRecord } from "./workbenchClient.js";
import type { BookstackOperationReceipt } from "./types.js";

const entryType = "pi-web.bookstack-write-intent";

export function bookstackBookFingerprint(resourceName: string): string {
  return createHash("sha256").update(resourceName).digest("hex");
}

export interface BookstackSessionJournal {
  getBranch(): readonly unknown[];
  getEntries?(): readonly unknown[];
  appendCustomEntry?(type: string, data: unknown): string;
}

interface WriteIntent {
  book: string;
  fingerprint: string;
  turnId: string;
  key: string;
  status: "pending" | "succeeded" | "failed";
  operationId?: string;
  reviewTurn?: string;
}

/** Only correlation metadata goes in the daemon-owned session file. */
export class BookstackWriteIntents {
  private readonly latest = new Map<string, WriteIntent>();

  constructor(private readonly journal?: BookstackSessionJournal) {
    for (const entry of journal?.getEntries?.() ?? journal?.getBranch() ?? []) {
      if (!isRecord(entry) || entry["type"] !== "custom" || entry["customType"] !== entryType) continue;
      const row = entry["data"];
      if (!isRecord(row) || typeof row["book"] !== "string" || typeof row["fingerprint"] !== "string" || typeof row["turnId"] !== "string" || typeof row["key"] !== "string"
        || (row["status"] !== "pending" && row["status"] !== "succeeded" && row["status"] !== "failed")) {
        throw new Error("Invalid BookStack write intent in session history");
      }
      this.latest.set(row["fingerprint"], { book: row["book"], fingerprint: row["fingerprint"], turnId: row["turnId"], key: row["key"], status: row["status"],
        ...(typeof row["reviewTurn"] === "string" ? { reviewTurn: row["reviewTurn"] } : {}),
        ...(typeof row["operationId"] === "string" ? { operationId: row["operationId"] } : {}) });
    }
  }

  currentTurn(toolCallId: string): string {
    const branch = this.journal?.getBranch() ?? [];
    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index];
      if (isRecord(entry) && entry["type"] === "message" && typeof entry["id"] === "string"
        && isRecord(entry["message"]) && entry["message"]["role"] === "user") return entry["id"];
    }
    return this.journal === undefined ? toolCallId : "no-user-turn";
  }

  prior(fingerprint: string, turnId: string): WriteIntent | undefined {
    const row = this.latest.get(fingerprint);
    return row?.status === "pending" || (row?.operationId !== undefined && row.turnId === turnId) ? row : undefined;
  }

  requiresReview(book: string, fingerprint: string, turnId: string): WriteIntent | undefined {
    for (const row of this.latest.values()) {
      if (row.book === book && row.fingerprint !== fingerprint && (row.status === "pending" || row.reviewTurn === turnId)) return row;
    }
    return undefined;
  }

  record(row: WriteIntent): void {
    if (this.journal) {
      if (!this.journal.appendCustomEntry) throw new Error("Session cannot persist a BookStack write intent");
      this.journal.appendCustomEntry(entryType, row);
    }
    this.latest.set(row.fingerprint, row);
  }

  receipt(key: string | undefined, result: Pick<BookstackOperationReceipt, "resourceName" | "operationId" | "status" | "resolution">, turnId?: string, reviewTurn?: string): void {
    const { operationId, status } = result;
    const book = bookstackBookFingerprint(result.resourceName);
    for (const row of this.latest.values()) {
      if (row.status === "pending" && row.book === book && (row.operationId === undefined ? row.key === key : row.operationId === operationId)) {
        const next = result.resolution ? (result.resolution.outcome === "applied" ? "succeeded" : "failed") : status === "unknown" ? "pending" : status;
        const acknowledgedTurn = next === "pending" ? row.turnId : turnId ?? row.turnId;
        if (row.operationId !== operationId || next !== row.status || acknowledgedTurn !== row.turnId || (reviewTurn !== undefined && reviewTurn !== row.reviewTurn)) {
          this.record({ ...row, operationId, turnId: acknowledgedTurn, status: next, ...(reviewTurn !== undefined ? { reviewTurn } : {}) });
        }
      }
    }
  }
}

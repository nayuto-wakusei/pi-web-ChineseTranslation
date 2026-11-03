import { randomBytes } from "node:crypto";
import type { ManagementEmbedContext } from "./managementEmbed.js";

const TICKET_TTL_MS = 60_000;
const MAX_PENDING_TICKETS = 256;
const MAX_PENDING_BYTES = 8 * 1024 * 1024;

export class ManagementEntryTickets {
  private readonly entries = new Map<string, { context: ManagementEmbedContext; expiresAt: number; bytes: number }>();
  private bytes = 0;

  constructor(private readonly now: () => number = Date.now) {}

  create(context: ManagementEmbedContext): { ticket: string; expiresAt: string } | undefined {
    this.prune();
    const bytes = Buffer.byteLength(JSON.stringify(context));
    if (this.entries.size >= MAX_PENDING_TICKETS || this.bytes + bytes > MAX_PENDING_BYTES) return undefined;
    const expiresAt = Math.min(this.now() + TICKET_TTL_MS, context.expiresAt === undefined ? Infinity : Date.parse(context.expiresAt));
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) return undefined;
    const ticket = randomBytes(32).toString("base64url");
    this.entries.set(ticket, { context, expiresAt, bytes });
    this.bytes += bytes;
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  take(ticket: string): ManagementEmbedContext | undefined {
    this.prune();
    const entry = this.entries.get(ticket);
    if (entry === undefined) return undefined;
    this.entries.delete(ticket);
    this.bytes -= entry.bytes;
    return entry.context;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  private prune(): void {
    for (const [ticket, entry] of this.entries) {
      if (entry.expiresAt > this.now()) continue;
      this.entries.delete(ticket);
      this.bytes -= entry.bytes;
    }
  }
}

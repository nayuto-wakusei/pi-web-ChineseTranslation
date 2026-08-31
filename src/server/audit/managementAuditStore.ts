import { randomUUID } from "node:crypto";

export type ManagementAuditStatus = "started" | "completed" | "failed";

export interface ManagementAuditIdentity {
  userId: string;
  rootUserId: string;
  userDisplayName?: string;
  projectId: string;
}

export interface ManagementAuditEvent extends ManagementAuditIdentity {
  action: "tool_execution" | "workbench_capability_call" | "workbench_knowledge_retrieval" | "workbench_skill_sync" | "user_prompt" | "assistant_response";
  status: ManagementAuditStatus;
  sessionId: string;
  cwd: string;
  toolName?: string;
  toolCallId?: string;
  agentSessionId?: string;
  authorizationRevision?: number;
  capabilityName?: string;
  capabilityVersion?: string;
  knowledgeName?: string;
  knowledgeVersion?: string;
  skillName?: string;
  skillVersion?: string;
  runId?: string;
  traceId?: string;
  mcpTraceId?: string;
  statusCode?: number | string;
  durationMs?: number;
  retryCount?: number;
  resultCount?: number;
  content?: unknown;
}

export interface ManagementAuditRecorder {
  record(event: ManagementAuditEvent): void;
}

export interface ManagementAuditStoreOptions {
  baseUrl: string;
  indexPrefix: string;
  retentionDays: number;
  apiKey?: string;
  username?: string;
  password?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  flushIntervalMs?: number;
  maintenanceIntervalMs?: number;
  maxQueueSize?: number;
  onError?: (error: unknown) => void;
}

interface QueuedAuditDocument {
  id: string;
  index: string;
  document: Record<string, unknown>;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_MAINTENANCE_INTERVAL_MS = DAY_MS;
const DEFAULT_MAX_QUEUE_SIZE = 10_000;
const TEMPLATE_VERSION = 3;

export class ManagementAuditStore implements ManagementAuditRecorder {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly queue: QueuedAuditDocument[] = [];
  private readonly flushIntervalMs: number;
  private readonly maxQueueSize: number;
  private flushTimer: NodeJS.Timeout | undefined;
  private maintenanceTimer: NodeJS.Timeout | undefined;
  private flushPromise: Promise<void> | undefined;
  private maintenanceMonth: string | undefined;
  private closed = false;

  constructor(private readonly options: ManagementAuditStoreOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  }

  async initialize(): Promise<void> {
    const interval = this.options.maintenanceIntervalMs ?? DEFAULT_MAINTENANCE_INTERVAL_MS;
    if (interval > 0) {
      this.maintenanceTimer = setInterval(() => {
        void this.runMaintenanceCycle().catch((error: unknown) => { this.options.onError?.(error); });
      }, interval);
      this.maintenanceTimer.unref();
    }
    await this.runMaintenanceCycle();
  }

  record(event: ManagementAuditEvent): void {
    if (this.closed) return;
    const timestamp = this.now();
    const id = randomUUID();
    this.queue.push({
      id,
      index: managementAuditIndexName(this.options.indexPrefix, timestamp),
      document: managementAuditDocument(id, timestamp, event),
    });
    if (this.queue.length > this.maxQueueSize) {
      this.queue.splice(0, this.queue.length - this.maxQueueSize);
      this.options.onError?.(new Error("management audit queue reached its size limit; oldest records were dropped"));
    }
    this.scheduleFlush();
  }

  flush(): Promise<void> {
    if (this.flushPromise !== undefined) return this.flushPromise;
    this.flushPromise = this.flushQueued().finally(() => {
      this.flushPromise = undefined;
      if (this.queue.length > 0 && !this.closed) this.scheduleFlush();
    });
    return this.flushPromise;
  }

  async maintain(): Promise<void> {
    const now = this.now();
    const month = shanghaiMonth(now);
    if (this.maintenanceMonth === month) return;
    const cutoff = new Date(now.getTime() - this.options.retentionDays * DAY_MS);
    const pattern = encodeURIComponent(`${this.options.indexPrefix}-*`);
    await this.request(`${pattern}/_delete_by_query?conflicts=proceed&refresh=false`, {
      method: "POST",
      body: JSON.stringify({ query: { range: { "@timestamp": { lt: cutoff.toISOString() } } } }),
      headers: { "content-type": "application/json" },
    }, [200, 404]);
    this.maintenanceMonth = month;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer);
    if (this.maintenanceTimer !== undefined) clearInterval(this.maintenanceTimer);
    do {
      await this.flush();
    } while (this.queue.length > 0);
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush().catch((error: unknown) => { this.options.onError?.(error); });
    }, this.flushIntervalMs);
    this.flushTimer.unref();
  }

  private async flushQueued(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    const body = `${batch.flatMap((entry) => [
      JSON.stringify({ index: { _index: entry.index, _id: entry.id } }),
      JSON.stringify(entry.document),
    ]).join("\n")}\n`;
    try {
      const response = await this.request("_bulk", {
        method: "POST",
        body,
        headers: { "content-type": "application/x-ndjson" },
      });
      const result: unknown = await response.json();
      if (isRecord(result) && result["errors"] === true) throw new Error("Elasticsearch rejected one or more management audit records");
    } catch (error) {
      this.queue.unshift(...batch);
      if (this.queue.length > this.maxQueueSize) this.queue.length = this.maxQueueSize;
      throw error;
    }
  }

  private async installIndexTemplate(): Promise<void> {
    const name = encodeURIComponent(`${this.options.indexPrefix}-template`);
    await this.request(`_index_template/${name}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        index_patterns: [`${this.options.indexPrefix}-*`],
        priority: 200,
        version: TEMPLATE_VERSION,
        template: {
          settings: { number_of_shards: 1 },
          mappings: {
            dynamic: false,
            properties: {
              "@timestamp": { type: "date" },
              event: { properties: { id: { type: "keyword" }, action: { type: "keyword" }, status: { type: "keyword" }, duration_ms: { type: "long" } } },
              user: { properties: { id: { type: "keyword" }, root_user_id: { type: "keyword" } } },
              project: { properties: { id: { type: "keyword" } } },
              session: { properties: { id: { type: "keyword" }, agent_session_id: { type: "keyword" } } },
              workspace: { properties: { cwd: { type: "keyword", ignore_above: 4096 } } },
              tool: { properties: { name: { type: "keyword" }, call_id: { type: "keyword" } } },
              content: { enabled: false },
              workbench: { properties: {
                authorization_revision: { type: "integer" }, capability_name: { type: "keyword" }, capability_version: { type: "keyword" },
                knowledge_name: { type: "keyword" }, knowledge_version: { type: "keyword" },
                skill_name: { type: "keyword" }, skill_version: { type: "keyword" }, run_id: { type: "keyword" }, trace_id: { type: "keyword" },
                mcp_trace_id: { type: "keyword" }, status_code: { type: "keyword" }, retry_count: { type: "integer" },
                result_count: { type: "integer" },
              } },
            },
          },
        },
      }),
    });
  }

  private async runMaintenanceCycle(): Promise<void> {
    await this.installIndexTemplate();
    await this.maintain();
  }

  private async request(path: string, init: RequestInit, acceptedStatuses: readonly number[] = [200]): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.options.apiKey !== undefined) headers.set("authorization", `ApiKey ${this.options.apiKey}`);
    else if (this.options.username !== undefined && this.options.password !== undefined) {
      headers.set("authorization", `Basic ${Buffer.from(`${this.options.username}:${this.options.password}`).toString("base64")}`);
    }
    const response = await this.fetchImpl(new URL(path, trailingSlash(this.options.baseUrl)), { ...init, headers, signal: AbortSignal.timeout(10_000) });
    if (!acceptedStatuses.includes(response.status)) throw new Error(`Elasticsearch management audit request failed with HTTP ${String(response.status)}`);
    return response;
  }
}

export function managementAuditIndexName(prefix: string, date: Date): string {
  const local = shanghaiDateParts(date);
  const target = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const isoYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
  return `${prefix}-${String(isoYear)}-w${String(week).padStart(2, "0")}`;
}

function managementAuditDocument(id: string, timestamp: Date, event: ManagementAuditEvent): Record<string, unknown> {
  return {
    "@timestamp": timestamp.toISOString(),
    event: { id, action: event.action, status: event.status, ...(event.durationMs === undefined ? {} : { duration_ms: event.durationMs }) },
    user: { id: event.userId, root_user_id: event.rootUserId, ...(event.userDisplayName === undefined ? {} : { name: event.userDisplayName }) },
    project: { id: event.projectId },
    session: { id: event.sessionId, ...(event.agentSessionId === undefined ? {} : { agent_session_id: event.agentSessionId }) },
    workspace: { cwd: event.cwd },
    ...((event.toolName === undefined && event.toolCallId === undefined) ? {} : { tool: { ...(event.toolName === undefined ? {} : { name: event.toolName }), ...(event.toolCallId === undefined ? {} : { call_id: event.toolCallId }) } }),
    ...(event.content === undefined ? {} : { content: event.content }),
    workbench: compact({
      authorization_revision: event.authorizationRevision,
      capability_name: event.capabilityName,
      capability_version: event.capabilityVersion,
      knowledge_name: event.knowledgeName,
      knowledge_version: event.knowledgeVersion,
      skill_name: event.skillName,
      skill_version: event.skillVersion,
      run_id: event.runId,
      trace_id: event.traceId,
      mcp_trace_id: event.mcpTraceId,
      status_code: event.statusCode === undefined ? undefined : String(event.statusCode),
      retry_count: event.retryCount,
      result_count: event.resultCount,
    }),
  };
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function shanghaiDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: number("year"), month: number("month"), day: number("day") };
}

function shanghaiMonth(date: Date): string {
  const { year, month } = shanghaiDateParts(date);
  return `${String(year)}-${String(month).padStart(2, "0")}`;
}

function trailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

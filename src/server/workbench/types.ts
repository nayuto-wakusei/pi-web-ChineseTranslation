export type WorkbenchResourceType = "capability" | "skill" | "knowledge";
export type WorkbenchResourceAction = "read" | "create" | "update" | "delete";

export interface AuthorizedResourceDependency {
  capabilityName: string;
  requirement: "required" | "optional";
}

export interface AuthorizedResource {
  resourceType: WorkbenchResourceType;
  resourceName: string;
  resourceVersion: string;
  source: "group" | "personal";
  riskLevel: string;
  status: string;
  displayName: string;
  description: string;
  dependencies: AuthorizedResourceDependency[];
  metadata: Record<string, unknown>;
  actions?: WorkbenchResourceAction[];
}

export interface WorkbenchAgentAccessState {
  sessionId: string;
  bearerToken: string;
  expiresAt: string;
  authorizationRevision: number;
  resources: AuthorizedResource[];
}

export interface CapabilityTokenRequest {
  capabilityName: string;
  capabilityVersion: string;
  runId: string;
  traceId: string;
  approvalCount: 0;
}

export interface SkillTicketRequest {
  skillName: string;
  skillVersion: string;
  runId: string;
  traceId: string;
  approvalCount: 0;
}

export interface KnowledgeTokenRequest {
  resourceName: string;
  resourceVersion: string;
  runId: string;
  traceId: string;
}

export interface StableCapabilityResult {
  ok: boolean;
  capability_name: string;
  status_code: number;
  data: unknown;
  error: null | { code: string; message: string; retryable: boolean };
  meta: { trace_id: string; duration_ms: number; truncated: boolean };
}

export interface KnowledgeRetrievalRequest {
  question: string;
  resourceName: string;
  topK?: number;
  filters?: Record<string, unknown>;
}

export interface KnowledgeRetrievalChunk {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  position: unknown[];
  version: string;
  source: string;
  citation: string;
}

export interface KnowledgeRetrievalResult {
  total: number;
  resourceName: string;
  resourceVersion: string;
  chunks: KnowledgeRetrievalChunk[];
}

export type BookstackRetrievalRequest = Omit<KnowledgeRetrievalRequest, "filters">;

export interface BookstackRetrievalPage {
  pageId: string;
  title: string;
  content: string;
  updatedAt: string;
  revision: number;
  url: string;
  citation: string;
}

export interface BookstackRetrievalResult {
  resourceName: string;
  resourceVersion: string;
  pages: BookstackRetrievalPage[];
  truncated: boolean;
}

export type BookstackEntityType = "book" | "chapter" | "page";
export const BOOKSTACK_OPERATION_ACTIONS = [
  "book.update", "book.delete", "chapter.create", "chapter.update", "chapter.delete", "page.create", "page.update", "page.delete",
] as const;
export type BookstackOperationAction = typeof BOOKSTACK_OPERATION_ACTIONS[number];

export interface BookstackReadRequest {
  resourceName: string;
  entityType: BookstackEntityType;
  entityId?: number;
}

export interface BookstackReadResult {
  resourceName: string;
  entityType: BookstackEntityType;
  entityId: number;
  content: Record<string, unknown>;
  baseVersion: string;
  actions: WorkbenchResourceAction[];
}

export interface BookstackOperationRequest {
  resourceName: string;
  action: BookstackOperationAction;
  entityId?: number;
  parentChapterId?: number;
  name?: string;
  html?: string;
  markdown?: string;
  baseVersion?: string;
  idempotencyKey: string;
}

export interface BookstackOperationResult {
  operationId: string;
  status: "succeeded" | "unknown";
  resourceName: string;
  action: BookstackOperationAction;
  entityId?: number;
  url?: string;
  message?: string;
}

export type BookstackOperationReceiptRequest = { resourceName: string } & (
  { operationId: string; idempotencyKey?: never } | { idempotencyKey: string; operationId?: never }
);

export interface BookstackOperationReceipt extends Omit<BookstackOperationResult, "status"> {
  status: "pending" | "succeeded" | "unknown" | "failed";
  createdAt: string;
  completedAt: string | null;
  actor: { id: string; username: string; displayName: string };
  failureStatus?: number;
  resolution?: {
    actorUserId: string;
    reason: string;
    resolvedAt: string;
    outcome: "applied" | "not_applied";
    entityId?: number;
  };
}

export interface WorkbenchSkillManifestFile {
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  isScript: boolean;
  secretFindings: unknown[];
}

export interface WorkbenchSkillManifest {
  name: string;
  version: string;
  status: string;
  contentSha256: string;
  dependencies: AuthorizedResourceDependency[];
  files: WorkbenchSkillManifestFile[];
}

export interface WorkbenchSkillReceipt {
  name: string;
  version: string;
  directory: string;
  contentSha256: string;
  files: { path: string; sizeBytes: number; sha256: string }[];
  degradedCapabilities: string[];
}

export interface WorkbenchSkillReceiptFile {
  authorizationRevision: number;
  skills: WorkbenchSkillReceipt[];
}

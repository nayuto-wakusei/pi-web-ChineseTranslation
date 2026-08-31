export type WorkbenchResourceType = "capability" | "skill" | "knowledge";

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

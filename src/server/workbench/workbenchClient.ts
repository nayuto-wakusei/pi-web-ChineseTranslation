import type {
  AuthorizedResource,
  CapabilityTokenRequest,
  KnowledgeRetrievalChunk,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
  KnowledgeTokenRequest,
  SkillTicketRequest,
  WorkbenchAgentAccessState,
} from "./types.js";

export class WorkbenchHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface WorkbenchClientOptions {
  baseUrl: string;
  requestTimeoutMs: number;
  fetch?: typeof fetch;
}

export class WorkbenchClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WorkbenchClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async createAgentAccessState(bootstrapToken: string, projectId: string): Promise<WorkbenchAgentAccessState> {
    const session = record(await this.json("/api/agent-access/sessions", {
      method: "POST",
      token: bootstrapToken,
      expectedStatus: 201,
      body: { projectId, regions: [] },
    }), "Agent Session response");
    const sessionId = stringField(session, "sessionId");
    const bearerToken = stringField(session, "token");
    const expiresAt = stringField(session, "expiresAt");
    const authorizationRevision = integerField(session, "authorizationRevision");
    const snapshot = record(await this.json("/api/agent-access/resources", {
      method: "GET",
      token: bearerToken,
      expectedStatus: 200,
    }), "resource snapshot");
    if (stringField(snapshot, "sessionId") !== sessionId || integerField(snapshot, "authorizationRevision") !== authorizationRevision) {
      throw new Error("Workbench resource snapshot does not match the Agent Session");
    }
    return { sessionId, bearerToken, expiresAt, authorizationRevision, resources: parseAuthorizedResources(snapshot["resources"]) };
  }

  async issueCapabilityToken(bearerToken: string, request: CapabilityTokenRequest): Promise<string> {
    return stringField(record(await this.json("/api/agent-access/capability-token", {
      method: "POST", token: bearerToken, expectedStatus: 200, body: request,
    }), "capability token response"), "token");
  }

  async issueSkillTicket(bearerToken: string, request: SkillTicketRequest): Promise<string> {
    return stringField(record(await this.json("/api/agent-access/skill-ticket", {
      method: "POST", token: bearerToken, expectedStatus: 200, body: request,
    }), "Skill ticket response"), "token");
  }

  async issueKnowledgeToken(bearerToken: string, request: KnowledgeTokenRequest): Promise<string> {
    return stringField(record(await this.json("/api/agent-access/knowledge-token", {
      method: "POST", token: bearerToken, expectedStatus: 200, body: request,
    }), "knowledge token response"), "token");
  }

  async retrieveKnowledge(knowledgeToken: string, request: KnowledgeRetrievalRequest): Promise<KnowledgeRetrievalResult> {
    return parseKnowledgeRetrievalResult(await this.json("/api/knowledge-access/retrieval", {
      method: "POST", token: knowledgeToken, expectedStatus: 200, body: request,
    }));
  }

  async revoke(state: Pick<WorkbenchAgentAccessState, "sessionId" | "bearerToken">): Promise<void> {
    await this.json(`/api/agent-access/sessions/${encodeURIComponent(state.sessionId)}/revoke`, {
      method: "POST", token: state.bearerToken, expectedStatus: 200,
    });
  }

  private async json(path: string, request: { method: string; token: string; expectedStatus: number; body?: unknown }): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${request.token}` };
    const init: RequestInit = {
      method: request.method,
      headers,
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    };
    if (request.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(request.body);
    }
    const response = await this.fetchImpl(new URL(path, trailingSlash(this.options.baseUrl)), init);
    const text = await response.text();
    if (response.status !== request.expectedStatus) throw new WorkbenchHttpError(response.status, responseMessage(text, response.status));
    try {
      const value: unknown = JSON.parse(text);
      return value;
    } catch {
      throw new Error(`Workbench returned invalid JSON for ${path}`);
    }
  }
}

export function parseAuthorizedResources(value: unknown): AuthorizedResource[] {
  if (!Array.isArray(value)) throw new Error("Workbench resources must be an array");
  return value.map((item) => {
    const resource = record(item, "authorized resource");
    const dependencies = resource["dependencies"];
    return {
      resourceType: enumField(resource, "resourceType", ["capability", "skill", "knowledge"] as const),
      resourceName: stringField(resource, "resourceName"),
      resourceVersion: stringField(resource, "resourceVersion"),
      source: enumField(resource, "source", ["group", "personal"] as const),
      riskLevel: stringField(resource, "riskLevel"),
      status: stringField(resource, "status"),
      displayName: stringField(resource, "displayName"),
      description: typeof resource["description"] === "string" ? resource["description"] : "",
      dependencies: Array.isArray(dependencies) ? dependencies.map((dependency) => {
        const entry = record(dependency, "resource dependency");
        return {
          capabilityName: stringField(entry, "capabilityName"),
          requirement: enumField(entry, "requirement", ["required", "optional"] as const),
        };
      }) : [],
      metadata: isRecord(resource["metadata"]) ? resource["metadata"] : {},
    };
  });
}

function parseKnowledgeRetrievalResult(value: unknown): KnowledgeRetrievalResult {
  const result = record(value, "knowledge retrieval response");
  const chunksValue = result["chunks"];
  if (!Array.isArray(chunksValue)) throw new Error("knowledge retrieval chunks must be an array");
  return {
    total: finiteNumberField(result, "total"),
    resourceName: stringField(result, "resourceName"),
    resourceVersion: stringField(result, "resourceVersion"),
    chunks: chunksValue.map(parseKnowledgeRetrievalChunk),
  };
}

function parseKnowledgeRetrievalChunk(value: unknown): KnowledgeRetrievalChunk {
  const chunk = record(value, "knowledge retrieval chunk");
  return {
    id: stringValueField(chunk, "id"),
    documentId: stringValueField(chunk, "documentId"),
    documentName: stringValueField(chunk, "documentName"),
    content: stringValueField(chunk, "content"),
    similarity: finiteNumberField(chunk, "similarity"),
    position: Array.isArray(chunk["position"]) ? chunk["position"] : [],
    version: stringValueField(chunk, "version"),
    source: stringValueField(chunk, "source"),
    citation: stringValueField(chunk, "citation"),
  };
}

function responseMessage(text: string, status: number): string {
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value) && typeof value["error"] === "string") return `Workbench HTTP ${String(status)}: ${value["error"]}`;
  } catch { /* response is not JSON */ }
  return `Workbench HTTP ${String(status)}`;
}

function trailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

export function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim() === "") throw new Error(`${key} must be a non-empty string`);
  return field.trim();
}

function integerField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isInteger(field)) throw new Error(`${key} must be an integer`);
  return field;
}

function finiteNumberField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) throw new Error(`${key} must be a finite number`);
  return field;
}

function stringValueField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`${key} must be a string`);
  return field;
}

function enumField<const T extends readonly string[]>(value: Record<string, unknown>, key: string, allowed: T): T[number] {
  const field = value[key];
  if (typeof field !== "string" || !allowed.includes(field)) throw new Error(`${key} is invalid`);
  return field;
}

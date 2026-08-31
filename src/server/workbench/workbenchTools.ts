import { randomUUID } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { requireAuthorizedL0Capability, searchAuthorizedCapabilities } from "./capabilitySearch.js";
import { requireAuthorizedRagflowKnowledge, searchAuthorizedKnowledge } from "./knowledgeSearch.js";
import { McpHttpError, McpTransportError, WorkbenchMcpClient } from "./mcpClient.js";
import type { KnowledgeRetrievalResult, WorkbenchAgentAccessState } from "./types.js";
import { WorkbenchClient, WorkbenchHttpError } from "./workbenchClient.js";
import type { ManagementAuditIdentity, ManagementAuditRecorder, ManagementAuditStatus } from "../audit/managementAuditStore.js";

const SearchCapabilitiesParams = Type.Object({
  keyword: Type.Optional(Type.String()),
  bizDomain: Type.Optional(Type.String()),
  packName: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
}, { additionalProperties: false });

const CallCapabilityParams = Type.Object({
  capability_name: Type.String(),
  arguments: Type.Record(Type.String(), Type.Unknown()),
  idempotency_key: Type.Optional(Type.String()),
}, { additionalProperties: false });

const SearchKnowledgeParams = Type.Object({
  keyword: Type.Optional(Type.String()),
  spaceCode: Type.Optional(Type.String()),
  domain: Type.Optional(Type.String()),
  classification: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
}, { additionalProperties: false });

const RetrieveKnowledgeParams = Type.Object({
  resource_name: Type.String(),
  question: Type.String(),
  resource_version: Type.Optional(Type.String()),
  top_k: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  filters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false });

export interface WorkbenchToolDependencies {
  getState(): WorkbenchAgentAccessState;
  workbench: WorkbenchClient;
  mcp: WorkbenchMcpClient;
  invalidate(): void;
  logger?: { info(details: Record<string, unknown>, message: string): void };
  audit?: ManagementAuditRecorder;
  auditContext?: ManagementAuditIdentity & { sessionId: string; cwd: string };
}

export function createWorkbenchToolDefinitions(deps: WorkbenchToolDependencies) {
  return [
    defineTool<typeof SearchCapabilitiesParams, undefined>({
      name: "icnoc_search_capabilities",
      label: "检索授权能力",
      description: "仅检索当前工作台会话已授权、已发布的L0只读能力。",
      promptSnippet: "检索当前账号已授权的网络能力",
      promptGuidelines: ["调用能力前先按问题检索；只能使用返回的精确能力名和输入Schema。"],
      parameters: SearchCapabilitiesParams,
      execute(_toolCallId, params) {
        const result = searchAuthorizedCapabilities(deps.getState().resources, params);
        return Promise.resolve({ content: [{ type: "text" as const, text: JSON.stringify(result) }], details: undefined });
      },
    }),
    defineTool<typeof SearchKnowledgeParams, undefined>({
      name: "workbench_search_knowledge",
      label: "检索授权知识",
      description: "仅检索当前工作台会话已授权、已发布的L0 RAGFlow知识资源。",
      promptSnippet: "检索当前账号已授权的知识资源",
      promptGuidelines: ["检索知识前先按问题搜索；只能使用返回的精确resourceName。"],
      parameters: SearchKnowledgeParams,
      execute(_toolCallId, params) {
        const result = searchAuthorizedKnowledge(deps.getState().resources, params);
        return Promise.resolve({ content: [{ type: "text" as const, text: JSON.stringify(result) }], details: undefined });
      },
    }),
    defineTool<typeof RetrieveKnowledgeParams, undefined>({
      name: "workbench_retrieve_knowledge",
      label: "检索授权知识内容",
      description: "通过工作台授权的短时一次性凭证检索RAGFlow知识资源。",
      promptSnippet: "检索一个已授权知识资源的内容",
      promptGuidelines: [
        "只能检索workbench_search_knowledge返回的resourceName。",
        "不要传入RAGFlow URL、dataset ID、租户ID或API Key。",
        "回答时优先引用返回的knowledge://citation。",
      ],
      parameters: RetrieveKnowledgeParams,
      async execute(_toolCallId, params) {
        const runId = `run-${randomUUID()}`;
        const traceId = `trace-${randomUUID()}`;
        const startedAt = Date.now();
        const state = deps.getState();
        try {
          const question = params.question.trim();
          if (question === "") throw new Error("知识检索问题不能为空");
          const resource = requireAuthorizedRagflowKnowledge(state.resources, params.resource_name, params.resource_version);
          const result = await retrieveKnowledgeOnce(deps, state.bearerToken, {
            resourceName: resource.resourceName,
            resourceVersion: resource.resourceVersion,
            question,
            ...(params.top_k === undefined ? {} : { topK: params.top_k }),
            ...(params.filters === undefined ? {} : { filters: params.filters }),
            runId,
            traceId,
          });
          deps.logger?.info({
            ...deps.auditContext,
            agentSessionId: state.sessionId,
            authorizationRevision: state.authorizationRevision,
            runId,
            traceId,
            knowledgeName: resource.resourceName,
            knowledgeVersion: resource.resourceVersion,
            statusCode: 200,
            durationMs: Date.now() - startedAt,
            resultCount: result.chunks.length,
          }, "Workbench knowledge retrieval completed");
          recordKnowledgeAudit(deps, {
            status: "completed",
            agentSessionId: state.sessionId,
            authorizationRevision: state.authorizationRevision,
            runId,
            traceId,
            knowledgeName: resource.resourceName,
            knowledgeVersion: resource.resourceVersion,
            statusCode: 200,
            durationMs: Date.now() - startedAt,
            resultCount: result.chunks.length,
          });
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: undefined };
        } catch (error) {
          deps.logger?.info({
            ...deps.auditContext,
            agentSessionId: state.sessionId,
            authorizationRevision: state.authorizationRevision,
            runId,
            traceId,
            knowledgeName: params.resource_name,
            statusCode: errorStatus(error),
            errorCode: errorCode(error),
            durationMs: Date.now() - startedAt,
          }, "Workbench knowledge retrieval rejected or failed");
          recordKnowledgeAudit(deps, {
            status: "failed",
            agentSessionId: state.sessionId,
            authorizationRevision: state.authorizationRevision,
            runId,
            traceId,
            knowledgeName: params.resource_name,
            statusCode: errorStatus(error),
            durationMs: Date.now() - startedAt,
          });
          throw error;
        }
      },
    }),
    defineTool<typeof CallCapabilityParams, undefined>({
      name: "icnoc_call_capability",
      label: "调用授权能力",
      description: "调用当前工作台会话已授权的L0只读能力。",
      promptSnippet: "调用一个已授权的网络能力",
      promptGuidelines: ["只能调用icnoc_search_capabilities返回的能力；arguments必须符合其inputSchema。"],
      parameters: CallCapabilityParams,
      async execute(_toolCallId, params) {
        const runId = `run-${randomUUID()}`;
        const traceId = `trace-${randomUUID()}`;
        const startedAt = Date.now();
        const state = deps.getState();
        try {
          const capability = requireAuthorizedL0Capability(state.resources, params.capability_name);
          const invocation = await callWithOneTransientRetry(deps, capability.resourceName, capability.resourceVersion, params.arguments, params.idempotency_key, runId, traceId);
          deps.logger?.info({
            ...deps.auditContext,
            agentSessionId: state.sessionId,
            authorizationRevision: state.authorizationRevision,
            runId,
            traceId,
            mcpTraceId: invocation.result.meta.trace_id,
            capabilityName: capability.resourceName,
            capabilityVersion: capability.resourceVersion,
            statusCode: invocation.result.status_code,
            durationMs: Date.now() - startedAt,
            retryCount: invocation.retryCount,
          }, "Workbench capability call completed");
          recordCapabilityAudit(deps, {
            status: invocation.result.ok ? "completed" : "failed",
            agentSessionId: state.sessionId,
            authorizationRevision: state.authorizationRevision,
            runId,
            traceId,
            mcpTraceId: invocation.result.meta.trace_id,
            capabilityName: capability.resourceName,
            capabilityVersion: capability.resourceVersion,
            statusCode: invocation.result.status_code,
            durationMs: Date.now() - startedAt,
            retryCount: invocation.retryCount,
          });
          return { content: [{ type: "text", text: JSON.stringify(invocation.result) }], details: undefined };
        } catch (error) {
          deps.logger?.info({
            ...deps.auditContext,
            agentSessionId: state.sessionId,
            authorizationRevision: state.authorizationRevision,
            runId,
            traceId,
            capabilityName: params.capability_name,
            statusCode: errorStatus(error),
            errorCode: errorCode(error),
            durationMs: Date.now() - startedAt,
          }, "Workbench capability call rejected or failed");
          recordCapabilityAudit(deps, {
            status: "failed",
            agentSessionId: state.sessionId,
            authorizationRevision: state.authorizationRevision,
            runId,
            traceId,
            capabilityName: params.capability_name,
            statusCode: errorStatus(error),
            durationMs: Date.now() - startedAt,
          });
          throw error;
        }
      },
    }),
  ];
}

function recordKnowledgeAudit(
  deps: WorkbenchToolDependencies,
  details: {
    status: ManagementAuditStatus;
    agentSessionId: string;
    authorizationRevision: number;
    runId: string;
    traceId: string;
    knowledgeName: string;
    knowledgeVersion?: string;
    statusCode: number | string;
    durationMs: number;
    resultCount?: number;
  },
): void {
  if (deps.audit === undefined || deps.auditContext === undefined) return;
  try {
    deps.audit.record({ action: "workbench_knowledge_retrieval", ...deps.auditContext, ...details });
  } catch (error) {
    deps.logger?.info({
      userId: deps.auditContext.userId,
      sessionId: deps.auditContext.sessionId,
      traceId: details.traceId,
      error: error instanceof Error ? error.message : String(error),
    }, "failed to enqueue Workbench knowledge retrieval audit");
  }
}

function recordCapabilityAudit(
  deps: WorkbenchToolDependencies,
  details: {
    status: ManagementAuditStatus;
    agentSessionId: string;
    authorizationRevision: number;
    runId: string;
    traceId: string;
    capabilityName: string;
    capabilityVersion?: string;
    mcpTraceId?: string;
    statusCode: number | string;
    durationMs: number;
    retryCount?: number;
  },
): void {
  if (deps.audit === undefined || deps.auditContext === undefined) return;
  try {
    deps.audit.record({ action: "workbench_capability_call", ...deps.auditContext, ...details });
  } catch (error) {
    deps.logger?.info({
      userId: deps.auditContext.userId,
      sessionId: deps.auditContext.sessionId,
      traceId: details.traceId,
      error: error instanceof Error ? error.message : String(error),
    }, "failed to enqueue Workbench capability audit");
  }
}

async function callWithOneTransientRetry(
  deps: WorkbenchToolDependencies,
  capabilityName: string,
  capabilityVersion: string,
  args: Record<string, unknown>,
  idempotencyKey: string | undefined,
  runId: string,
  traceId: string,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const token = await deps.workbench.issueCapabilityToken(deps.getState().bearerToken, {
        capabilityName, capabilityVersion, runId, traceId, approvalCount: 0,
      });
      const result = await deps.mcp.callCapability(token, capabilityName, args, idempotencyKey);
      if (attempt === 0 && !result.ok && result.error?.retryable === true && [502, 503, 504].includes(result.status_code)) continue;
      return { result, retryCount: attempt };
    } catch (error) {
      if (error instanceof WorkbenchHttpError && error.status === 401) {
        deps.invalidate();
        throw new Error("当前资源授权已过期或发生变化，请返回工作台重新进入桂小智。", { cause: error });
      }
      if (attempt === 0 && error instanceof McpTransportError) continue;
      if (attempt === 0 && error instanceof McpHttpError && [502, 503, 504].includes(error.status)) continue;
      throw error;
    }
  }
  throw new Error("能力调用失败");
}

async function retrieveKnowledgeOnce(
  deps: WorkbenchToolDependencies,
  bearerToken: string,
  input: {
    resourceName: string;
    resourceVersion: string;
    question: string;
    topK?: number;
    filters?: Record<string, unknown>;
    runId: string;
    traceId: string;
  },
): Promise<KnowledgeRetrievalResult> {
  try {
    const token = await deps.workbench.issueKnowledgeToken(bearerToken, {
      resourceName: input.resourceName,
      resourceVersion: input.resourceVersion,
      runId: input.runId,
      traceId: input.traceId,
    });
    return await deps.workbench.retrieveKnowledge(token, {
      question: input.question,
      resourceName: input.resourceName,
      ...(input.topK === undefined ? {} : { topK: input.topK }),
      ...(input.filters === undefined ? {} : { filters: input.filters }),
    });
  } catch (error) {
    if (error instanceof WorkbenchHttpError && error.status === 401) {
      deps.invalidate();
      throw new Error("当前资源授权已过期或发生变化，请返回工作台重新进入桂小智。", { cause: error });
    }
    throw error;
  }
}

function errorStatus(error: unknown): number | string {
  if (error instanceof WorkbenchHttpError || error instanceof McpHttpError) return error.status;
  if (error instanceof McpTransportError) return `mcp_transport_${error.code}`;
  return "local_error";
}

function errorCode(error: unknown): string {
  if (error instanceof McpTransportError) return error.code;
  if (error instanceof WorkbenchHttpError) return `workbench_http_${String(error.status)}`;
  if (error instanceof McpHttpError) return `mcp_http_${String(error.status)}`;
  return error instanceof Error ? error.name : "unknown";
}

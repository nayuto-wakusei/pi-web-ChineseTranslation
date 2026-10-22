import type { FastifyInstance } from "fastify";
import type { McpAuthServersResponse, OAuthFlowState, SessionRef } from "../../shared/apiTypes.js";
import { normalizeRequestCwd } from "../workingDirectory.js";
import { attachWorkbenchAccessHandle, decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, WORKBENCH_ACCESS_HANDLE_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";
import { UserFacingError, userFacingErrorMessage, type Translator } from "../../shared/i18n.js";
import { loadNodeTranslator } from "../../localization.js";

export interface McpAuthRouteService {
  mcpAuthServers(ref: SessionRef, context?: ManagementEmbedContext): Promise<McpAuthServersResponse>;
  startMcpAuth(ref: SessionRef, mode: "login" | "logout", serverName?: string, context?: ManagementEmbedContext): Promise<OAuthFlowState>;
  mcpAuthFlow(flowId: string, context?: ManagementEmbedContext): Promise<OAuthFlowState>;
  respondToMcpAuthFlow(flowId: string, requestId: string, value: string, context?: ManagementEmbedContext): Promise<OAuthFlowState>;
  cancelMcpAuthFlow(flowId: string, context?: ManagementEmbedContext): Promise<OAuthFlowState>;
}

export function registerMcpAuthRoutes(app: FastifyInstance, sessions: McpAuthRouteService, prefix = "", translator: Translator = loadNodeTranslator("server")): void {
  app.get<{ Params: { sessionId: string }; Querystring: unknown }>(`${prefix}/sessions/:sessionId/mcp/auth/servers`, async (request, reply) => {
    reply.header("cache-control", "no-store");
    try {
      const query = record(request.query);
      onlyKeys(query, ["cwd", "embed", "token"]);
      const cwd = string(query, "cwd");
      if (!cwd) throw new UserFacingError("mcpAuth.cwdEmpty", "cwd must not be empty");
      return await sessions.mcpAuthServers({ id: identifier(request.params.sessionId), cwd: normalizeRequestCwd(cwd) }, managementContext(request.headers));
    } catch (error) { return reply.code(400).send({ error: userFacingErrorMessage(error, translator) }); }
  });
  app.post<{ Params: { sessionId: string }; Querystring: unknown; Body: unknown }>(`${prefix}/sessions/:sessionId/mcp/auth`, async (request, reply) => {
    reply.header("cache-control", "no-store");
    try {
      onlyKeys(record(request.query), ["embed", "token"]);
      const body = record(request.body);
      onlyKeys(body, ["cwd", "mode", "serverName"]);
      const cwd = string(body, "cwd");
      if (!cwd) throw new UserFacingError("mcpAuth.cwdEmpty", "cwd must not be empty");
      const mode = body["mode"];
      if (mode !== "login" && mode !== "logout") throw new UserFacingError("mcpAuth.invalidMode", "mode must be login or logout");
      const serverName = body["serverName"] === undefined ? undefined : string(body, "serverName");
      return await sessions.startMcpAuth({ id: identifier(request.params.sessionId), cwd: normalizeRequestCwd(cwd) }, mode, serverName, managementContext(request.headers));
    } catch (error) {
      return reply.code(400).send({ error: userFacingErrorMessage(error, translator) });
    }
  });
  app.get<{ Params: { flowId: string }; Querystring: unknown }>(`${prefix}/auth/mcp/:flowId`, async (request, reply) => {
    reply.header("cache-control", "no-store");
    try {
      onlyKeys(record(request.query), ["embed", "token"]);
      return await sessions.mcpAuthFlow(identifier(request.params.flowId), managementContext(request.headers));
    } catch (error) { return reply.code(404).send({ error: userFacingErrorMessage(error, translator) }); }
  });
  app.post<{ Params: { flowId: string }; Querystring: unknown; Body: unknown }>(`${prefix}/auth/mcp/:flowId/respond`, async (request, reply) => {
    reply.header("cache-control", "no-store");
    try {
      onlyKeys(record(request.query), ["embed", "token"]);
      const body = record(request.body);
      onlyKeys(body, ["requestId", "value"]);
      return await sessions.respondToMcpAuthFlow(identifier(request.params.flowId), string(body, "requestId"), string(body, "value"), managementContext(request.headers));
    } catch (error) { return reply.code(400).send({ error: userFacingErrorMessage(error, translator) }); }
  });
  app.post<{ Params: { flowId: string }; Querystring: unknown; Body: unknown }>(`${prefix}/auth/mcp/:flowId/cancel`, async (request, reply) => {
    reply.header("cache-control", "no-store");
    try {
      onlyKeys(record(request.query), ["embed", "token"]);
      if (request.body !== undefined) onlyKeys(record(request.body), []);
      return await sessions.cancelMcpAuthFlow(identifier(request.params.flowId), managementContext(request.headers));
    } catch (error) { return reply.code(400).send({ error: userFacingErrorMessage(error, translator) }); }
  });
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UserFacingError("mcpAuth.requestObject", "Expected a request object");
  return Object.fromEntries(Object.entries(value));
}
function string(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length > 32 * 1024) throw new UserFacingError("mcpAuth.invalidString", "{field} must be a string of at most 32768 characters", { field: key });
  return value;
}
function onlyKeys(body: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(body).some((key) => !keys.includes(key))) throw new UserFacingError("mcpAuth.unexpectedField", "Unexpected MCP authentication field");
}
function identifier(value: string): string {
  if (!value || value.length > 512) throw new UserFacingError("mcpAuth.invalidIdentifier", "Invalid MCP authentication identifier");
  return value;
}

function managementContext(headers: Record<string, string | string[] | undefined>): ManagementEmbedContext | undefined {
  const raw = headers[MANAGEMENT_EMBED_CONTEXT_HEADER];
  if (raw === undefined) return undefined;
  const context = decodeManagementContext(Array.isArray(raw) ? raw[0] : raw);
  if (context === undefined) throw new UserFacingError("mcpAuth.invalidManagementContext", "Invalid management context");
  const handle = headers[WORKBENCH_ACCESS_HANDLE_HEADER];
  return attachWorkbenchAccessHandle(context, Array.isArray(handle) ? handle[0] : handle);
}

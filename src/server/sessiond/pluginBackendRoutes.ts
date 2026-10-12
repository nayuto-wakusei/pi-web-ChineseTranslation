import type { FastifyInstance, FastifyReply } from "fastify";
import { isPiWebPluginId } from "../../shared/pluginIds.js";
import {
  PAIRED_PLUGIN_BACKEND_REQUEST_ROUTE_PATH,
  parsePluginBackendRequestEnvelope,
  PLUGIN_BACKEND_REQUEST_BODY_MAX_BYTES,
  PLUGIN_BACKEND_RESPONSE_JSON_MAX_BYTES,
  requirePluginBackendOperation,
  serializeBoundedPluginBackendJson,
  type PluginBackendRequestEnvelope,
} from "../../shared/pluginBackendProtocol.js";
import { requestCancellation } from "../requestCancellation.js";
import type { Project } from "../types.js";
import { eventScopeFromManagementContext, type SessionEventScope } from "../realtime/sessionEventScope.js";
import { PluginBackendRequestError, type PluginBackendRequest } from "../plugins/pluginBackendRegistry.js";
import { managementContextFromSessiondHeaders, resolveSessiondProject, type SessiondProjectReader } from "./managementProjectResolver.js";

interface PluginBackendRouteParams {
  pluginId: string;
  projectId: string;
  workspaceId: string;
  operation: string;
}

export interface PluginBackendDispatcher {
  request(request: PluginBackendRequest, signal?: AbortSignal): Promise<unknown>;
}

export interface PluginBackendRouteDependencies {
  projects: SessiondProjectReader;
  backends: PluginBackendDispatcher;
  managementProjectRoot?: string | undefined;
  onWorkspacesMutated?: (scope: SessionEventScope) => void;
}

export function registerPairedPluginBackendRoutes(app: FastifyInstance, dependencies: PluginBackendRouteDependencies): void {
  registerPluginBackendRoutes(app, dependencies);
}

/** JSON-only sessiond boundary for a revision-paired plugin and current workspace. */
export function registerPluginBackendRoutes(
  app: FastifyInstance,
  dependencies: PluginBackendRouteDependencies,
  prefix = "",
): void {
  app.post<{ Params: PluginBackendRouteParams; Body: unknown }>(
    `${prefix}${PAIRED_PLUGIN_BACKEND_REQUEST_ROUTE_PATH}`,
    { bodyLimit: PLUGIN_BACKEND_REQUEST_BODY_MAX_BYTES },
    async (request, reply) => {
      const { pluginId, projectId, workspaceId } = request.params;
      let operation = request.params.operation;
      let envelope: PluginBackendRequestEnvelope;
      try {
        if (!isPiWebPluginId(pluginId)) throw new Error(`Invalid PI WEB plugin id: ${pluginId}`);
        operation = requirePluginBackendOperation(operation);
        if (projectId === "") throw new Error("Project id is required");
        if (workspaceId === "") throw new Error("Workspace id is required");
        envelope = parsePluginBackendRequestEnvelope(request.body);
      } catch (error) {
        return attributedError(reply, 400, boundedErrorMessage(error), "invalid-request", pluginId, operation);
      }

      let project: Project;
      try {
        project = await resolveSessiondProject(request.headers, projectId, dependencies);
      } catch (error) {
        const message = boundedErrorMessage(error);
        return attributedError(
          reply,
          projectErrorStatus(message),
          message,
          projectErrorCode(message),
          pluginId,
          operation,
        );
      }

      const cancellation = requestCancellation(request, reply);
      const managementContext = managementContextFromSessiondHeaders(request.headers);
      try {
        const result = await dependencies.backends.request({
          pluginId,
          moduleRevision: envelope.revision,
          project,
          workspaceId,
          operation,
          input: envelope.input,
          ...(managementContext === undefined ? {} : { managementContext }),
        }, cancellation.signal);
        const serialized = serializeBoundedPluginBackendJson(
          result,
          `Server plugin ${pluginId} operation ${operation} result`,
          PLUGIN_BACKEND_RESPONSE_JSON_MAX_BYTES,
        );
        return await reply.type("application/json; charset=utf-8").send(serialized);
      } catch (error) {
        return await pluginBackendRequestFailed(reply, error, pluginId, operation);
      } finally {
        cancellation.dispose();
        dependencies.onWorkspacesMutated?.(eventScopeFromManagementContext(managementContext));
      }
    },
  );
}

function pluginBackendRequestFailed(
  reply: FastifyReply,
  error: unknown,
  pluginId: string,
  operation: string,
): FastifyReply {
  if (error instanceof PluginBackendRequestError) {
    return attributedError(reply, error.statusCode, error.message, error.code, pluginId, operation);
  }
  return attributedError(
    reply,
    502,
    `Plugin backend request failed: ${boundedErrorMessage(error)}`,
    "request-failed",
    pluginId,
    operation,
  );
}

function attributedError(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  code: string,
  pluginId: string,
  operation: string,
): FastifyReply {
  return reply.code(statusCode).send({ error: message, code, pluginId, operation });
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 2_048 ? message : `${message.slice(0, 2_045)}...`;
}

function projectErrorStatus(message: string): number {
  if (message === "Project not found") return 404;
  if (message === "Project is not authorized for this management session") return 403;
  return 500;
}

function projectErrorCode(message: string): string {
  if (message === "Project not found") return "project-not-found";
  if (message === "Project is not authorized for this management session") return "project-not-authorized";
  return "project-resolution-failed";
}

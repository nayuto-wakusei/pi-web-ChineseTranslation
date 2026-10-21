import type { FastifyInstance, FastifyReply } from "fastify";
import {
  PAIRED_PLUGIN_BACKEND_REQUEST_ROUTE_PATHS,
  pairedPluginBackendPath,
  PLUGIN_BACKEND_REQUEST_BODY_MAX_BYTES,
  PLUGIN_BACKEND_RESPONSE_BODY_MAX_BYTES,
  utf8ByteLength,
} from "../../shared/pluginBackendProtocol.js";
import type { SessionDaemonRequestClient } from "../../sessiond/sessionDaemonClient.js";
import { sessionDaemonProxyFailure } from "../../sessiond/sessionDaemonErrors.js";
import { managementContextForRequest, managementHeaders, type ManagementEmbedRuntime } from "../managementEmbed.js";
import { withRequestCancellation } from "../requestCancellation.js";

interface PluginBackendProxyParams {
  pluginId: string;
  projectId?: string;
  workspaceId?: string;
  operation: string;
}

export function registerPairedPluginBackendProxyRoutes(app: FastifyInstance, daemon: SessionDaemonRequestClient): void {
  registerPluginBackendProxyRoutes(app, daemon);
}

/** Browser-facing local route; all owner resolution and execution stays in sessiond. */
export function registerPluginBackendProxyRoutes(
  app: FastifyInstance,
  daemon: SessionDaemonRequestClient,
  prefix = "/api",
  managementEmbed?: ManagementEmbedRuntime,
): void {
  for (const path of PAIRED_PLUGIN_BACKEND_REQUEST_ROUTE_PATHS) app.post<{ Params: PluginBackendProxyParams; Body: unknown }>(
    `${prefix}${path}`,
    { bodyLimit: PLUGIN_BACKEND_REQUEST_BODY_MAX_BYTES },
    async (request, reply) => {
      const path = daemonPluginBackendPath(request.params);
      const managementContext = await managementContextForRequest(request, managementEmbed, reply);
      if (managementContext !== undefined && request.params.workspaceId === undefined) {
        return reply.code(403).send({ error: "Management plugin backends require workspace scope", code: "invalid-scope", pluginId: request.params.pluginId, operation: request.params.operation });
      }
      let upstream: Awaited<ReturnType<SessionDaemonRequestClient["request"]>>;
      try {
        upstream = await withRequestCancellation(request, reply, (signal) => (
          daemon.request("POST", path, request.body, managementHeaders(managementContext, managementEmbed), signal)
        ));
      } catch (error) {
        const failure = sessionDaemonProxyFailure(error);
        return reply.code(failure.statusCode).send({
          error: failure.error,
          code: failure.statusCode === 499 ? "daemon-cancelled" : failure.statusCode === 504 ? "daemon-timeout" : "daemon-unavailable",
          pluginId: request.params.pluginId,
          operation: request.params.operation,
        });
      }

      if (upstream.body === "" || utf8ByteLength(upstream.body) > PLUGIN_BACKEND_RESPONSE_BODY_MAX_BYTES) {
        return daemonProtocolError(reply, request.params, "Session daemon plugin backend returned an invalid response size");
      }

      let body: unknown;
      try {
        body = JSON.parse(upstream.body);
      } catch {
        return daemonProtocolError(reply, request.params, "Session daemon plugin backend returned invalid JSON");
      }
      if (isUnknownPluginBackendRoute(upstream.statusCode, body)) {
        return daemonProtocolError(
          reply,
          request.params,
          "Session daemon does not support plugin backend requests; restart or upgrade the session daemon",
        );
      }

      return await reply
        .code(upstream.statusCode)
        .type("application/json; charset=utf-8")
        .send(upstream.body);
    },
  );
}

function daemonPluginBackendPath(params: PluginBackendProxyParams): string {
  return pairedPluginBackendPath(params);
}

function daemonProtocolError(reply: FastifyReply, params: PluginBackendProxyParams, message: string): FastifyReply {
  return reply.code(502).send({
    error: message,
    code: "daemon-protocol-error",
    pluginId: params.pluginId,
    operation: params.operation,
  });
}

function isUnknownPluginBackendRoute(statusCode: number, body: unknown): boolean {
  if (statusCode !== 404 || !isRecord(body)) return false;
  const error = body["error"];
  const message = body["message"];
  return error === "Not Found" || (typeof message === "string" && /^Route .* not found$/u.test(message));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

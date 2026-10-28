import type { FastifyInstance } from "fastify";
import { PAIRED_PLUGIN_BACKEND_RESOURCE_ROUTE_PATHS, pairedPluginBackendResourcePath, parsePluginBackendResourceQuery } from "../../shared/pluginBackendProtocol.js";
import type { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import type { PluginBackendResourceParams } from "../sessiond/pluginBackendResourceRoutes.js";
import { requestCancellation } from "../requestCancellation.js";
import { applyPluginResourcePolicy, pluginResourceError, pluginResourceRange, sendPluginResourceResponse } from "./pluginBackendResourceResponse.js";
import { managementContextForRequest, managementHeaders, type ManagementEmbedRuntime } from "../managementEmbed.js";

export function registerPluginBackendResourceProxyRoutes(app: FastifyInstance, daemon: Pick<SessionDaemonClient, "requestStream">, prefix = "/api", managementEmbed?: ManagementEmbedRuntime): void {
  for (const path of PAIRED_PLUGIN_BACKEND_RESOURCE_ROUTE_PATHS) app.route<{ Params: PluginBackendResourceParams; Querystring: unknown }>({
    method: "GET", url: `${prefix}${path}`, exposeHeadRoute: false,
    handler: async (request, reply) => {
      applyPluginResourcePolicy(reply);
      const cancellation = requestCancellation(request, reply);
      try {
        const context = await managementContextForRequest(request, managementEmbed, reply);
        if (context !== undefined && request.params.workspaceId === undefined) return await pluginResourceError(reply, 403, new Error("Management plugin backends require workspace scope"));
        let envelope;
        let range;
        try {
          envelope = parsePluginBackendResourceQuery(request.query);
          range = pluginResourceRange(request.headers.range);
        } catch (error) { return await pluginResourceError(reply, 400, error); }
        const query = new URLSearchParams({ revision: envelope.revision, input: JSON.stringify(envelope.input) });
        const upstream = await daemon.requestStream(`${pairedPluginBackendResourcePath(request.params)}?${query.toString()}`, {
          signal: cancellation.signal, headers: { ...managementHeaders(context, managementEmbed), ...(range === undefined ? {} : { range }) }, timeoutMs: 30_000,
        });
        return await sendPluginResourceResponse(reply, upstream, cancellation.signal);
      } catch (error) { return await pluginResourceError(reply, 502, error); }
      finally { cancellation.dispose(); }
    },
  });
}

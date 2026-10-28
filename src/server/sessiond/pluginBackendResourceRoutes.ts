import type { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { isPiWebPluginId } from "../../shared/pluginIds.js";
import { PAIRED_PLUGIN_BACKEND_RESOURCE_ROUTE_PATHS, parsePluginBackendResourceQuery, pluginBackendScopeFromRoute, requirePluginBackendOperation } from "../../shared/pluginBackendProtocol.js";
import { PluginBackendRequestError, type PluginBackendRequest } from "../plugins/pluginBackendRegistry.js";
import { applyPluginResourcePolicy, pluginResourceError, pluginResourceRange, sendPluginResourceResponse } from "../plugins/pluginBackendResourceResponse.js";
import { requestCancellation } from "../requestCancellation.js";
import { managementContextFromSessiondHeaders, resolveSessiondProject, type SessiondProjectReader } from "./managementProjectResolver.js";

export interface PluginBackendResourceParams {
  pluginId: string;
  projectId?: string;
  workspaceId?: string;
  operation: string;
}

export interface PluginBackendResourceDispatcher {
  resource(request: PluginBackendRequest & { range?: string }, signal?: AbortSignal): Promise<{
    body: Readable;
    contentType: string;
    contentLength?: number;
    statusCode: 200 | 206 | 416;
    contentRange?: string;
    acceptRanges?: "bytes";
  }>;
}

export function registerPluginBackendResourceRoutes(app: FastifyInstance, dependencies: {
  projects: SessiondProjectReader;
  backends: PluginBackendResourceDispatcher;
  managementProjectRoot?: string | undefined;
}): void {
  for (const path of PAIRED_PLUGIN_BACKEND_RESOURCE_ROUTE_PATHS) app.route<{ Params: PluginBackendResourceParams; Querystring: unknown }>({
    method: "GET", url: path, exposeHeadRoute: false,
    handler: async (request, reply) => {
      applyPluginResourcePolicy(reply);
      const cancellation = requestCancellation(request, reply);
      try {
        const { pluginId, projectId, workspaceId, operation } = request.params;
        const managementContext = managementContextFromSessiondHeaders(request.headers);
        if (managementContext !== undefined && workspaceId === undefined) return await pluginResourceError(reply, 403, new Error("Management plugin backends require workspace scope"));
        let envelope;
        let range;
        try {
          if (!isPiWebPluginId(pluginId)) throw new Error("Invalid PI WEB plugin id");
          requirePluginBackendOperation(operation);
          envelope = parsePluginBackendResourceQuery(request.query);
          range = pluginResourceRange(request.headers.range);
        } catch (error) { return await pluginResourceError(reply, 400, error); }
        let project;
        try {
          project = projectId === undefined ? undefined : await resolveSessiondProject(request.headers, projectId, dependencies);
        } catch (error) { return await pluginResourceError(reply, error instanceof Error && error.message === "Project not found" ? 404 : 500, error); }
        const result = await dependencies.backends.resource({
          pluginId, moduleRevision: envelope.revision, scope: pluginBackendScopeFromRoute(request.params),
          project, workspaceId, operation, input: envelope.input, ...(range === undefined ? {} : { range }),
          ...(managementContext === undefined ? {} : { managementContext }),
        }, cancellation.signal);
        return await sendPluginResourceResponse(reply, {
          statusCode: result.statusCode, body: result.body,
          headers: {
            "content-type": result.contentType,
            ...(result.contentLength === undefined ? {} : { "content-length": String(result.contentLength) }),
            ...(result.contentRange === undefined ? {} : { "content-range": result.contentRange }),
            ...(result.acceptRanges === undefined ? {} : { "accept-ranges": result.acceptRanges }),
          },
        }, cancellation.signal);
      } catch (error) {
        return await pluginResourceError(reply, error instanceof PluginBackendRequestError ? error.statusCode : 502, error);
      } finally { cancellation.dispose(); }
    },
  });
}

import type { FastifyInstance } from "fastify";
import type { WorkspaceActivityResponse } from "../../shared/apiTypes.js";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import { eventScopeFromManagementContext, type SessionEventScope } from "../realtime/sessionEventScope.js";

export interface WorkspaceActivityRouteService {
  snapshot(scope?: SessionEventScope): WorkspaceActivityResponse;
}

export function registerWorkspaceActivityRoutes(app: FastifyInstance, activity: WorkspaceActivityRouteService, prefix = ""): void {
  app.get(`${prefix}/activity`, (request) => activity.snapshot(eventScopeFromHeaders(request.headers)));
}

function eventScopeFromHeaders(headers: Record<string, string | string[] | undefined>): SessionEventScope {
  const raw = headers[MANAGEMENT_EMBED_CONTEXT_HEADER];
  return eventScopeFromManagementContext(decodeManagementContext(Array.isArray(raw) ? raw[0] : raw));
}

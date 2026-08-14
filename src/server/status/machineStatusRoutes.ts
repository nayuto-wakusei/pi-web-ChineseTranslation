import type { FastifyInstance } from "fastify";
import type { MachineStatusSnapshot } from "../../shared/machineStatus.js";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER } from "../managementEmbed.js";
import { eventScopeFromManagementContext, type SessionEventScope } from "../realtime/sessionEventScope.js";

export interface MachineStatusRouteService {
  snapshot(scope?: SessionEventScope): MachineStatusSnapshot;
}

export function registerMachineStatusRoutes(app: FastifyInstance, status: MachineStatusRouteService, prefix = ""): void {
  app.get(`${prefix}/status`, (request) => status.snapshot(eventScopeFromHeaders(request.headers)));
}

function eventScopeFromHeaders(headers: Record<string, string | string[] | undefined>): SessionEventScope {
  const raw = headers[MANAGEMENT_EMBED_CONTEXT_HEADER];
  return eventScopeFromManagementContext(decodeManagementContext(Array.isArray(raw) ? raw[0] : raw));
}

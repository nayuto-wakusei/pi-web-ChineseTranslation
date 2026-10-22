import type { SessionRef } from "../../../shared/apiTypes";
import { currentApiScope, type ApiScope, withManagementEmbedQuery } from "./managementEmbed";
import { resolveAppWebSocketUrl } from "../appUrl";
import { sessionEventsPath } from "./urls";

type SessionLookup = SessionRef | string;

export type SocketScope = ApiScope;

export function sessionEvents(session: SessionLookup, machineId = "local", scope: SocketScope = currentApiScope()): WebSocket {
  const endpoint = typeof session === "string"
    ? `${machinePrefix(machineId)}/sessions/${encodeURIComponent(session)}/events`
    : sessionEventsPath(session, machineId);
  const path = withManagementEmbedQuery(endpoint, undefined, scope);
  return new WebSocket(resolveAppWebSocketUrl(path));
}

export function globalSessionEvents(machineId = "local", scope: SocketScope = currentApiScope()): WebSocket {
  const path = withManagementEmbedQuery(`${machinePrefix(machineId)}/sessions/events`, undefined, scope);
  return new WebSocket(resolveAppWebSocketUrl(path));
}

export function realtimeEvents(machineId = "local", scope: SocketScope = currentApiScope()): WebSocket {
  const path = withManagementEmbedQuery(`${machinePrefix(machineId)}/events`, undefined, scope);
  return new WebSocket(resolveAppWebSocketUrl(path));
}

function machinePrefix(machineId: string): string {
  return `api/machines/${encodeURIComponent(machineId)}`;
}

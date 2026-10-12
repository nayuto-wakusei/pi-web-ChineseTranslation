import type { SessionRef } from "../../../shared/apiTypes";
import { currentApiScope, type ApiScope, withManagementEmbedQuery } from "./managementEmbed";
import { resolveAppWebSocketUrl } from "../appUrl";

type SessionLookup = SessionRef | string;

export type SocketScope = ApiScope;

export function sessionEvents(session: SessionLookup, machineId = "local", scope: SocketScope = currentApiScope()): WebSocket {
  const cwd = typeof session === "string" ? undefined : session.cwd;
  const query = cwd === undefined || cwd === "" ? "" : `?${new URLSearchParams({ cwd }).toString()}`;
  const sessionId = typeof session === "string" ? session : session.id;
  const path = withManagementEmbedQuery(`${machinePrefix(machineId)}/sessions/${encodeURIComponent(sessionId)}/events${query}`, undefined, scope);
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

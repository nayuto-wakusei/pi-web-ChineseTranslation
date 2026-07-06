import type { SessionRef } from "../../../shared/apiTypes";
import { currentApiScope, type ApiScope, withManagementEmbedQuery } from "./managementEmbed";

type SessionLookup = SessionRef | string;

export type SocketScope = ApiScope;

export function sessionEvents(session: SessionLookup, machineId = "local", scope: SocketScope = currentApiScope()): WebSocket {
  const cwd = typeof session === "string" ? undefined : session.cwd;
  const query = cwd === undefined || cwd === "" ? "" : `?${new URLSearchParams({ cwd }).toString()}`;
  const sessionId = typeof session === "string" ? session : session.id;
  const path = withManagementEmbedQuery(`${machinePrefix(machineId)}/sessions/${encodeURIComponent(sessionId)}/events${query}`, undefined, scope);
  return new WebSocket(`${webSocketBaseUrl()}${path}`);
}

export function globalSessionEvents(machineId = "local", scope: SocketScope = currentApiScope()): WebSocket {
  const path = withManagementEmbedQuery(`${machinePrefix(machineId)}/sessions/events`, undefined, scope);
  return new WebSocket(`${webSocketBaseUrl()}${path}`);
}

export function terminalSocket(projectId: string, workspaceId: string, terminalId: string, initialSize?: { cols: number; rows: number }, machineId = "local"): WebSocket {
  const sizeQuery = initialSize === undefined ? "" : `?cols=${encodeURIComponent(String(initialSize.cols))}&rows=${encodeURIComponent(String(initialSize.rows))}`;
  return new WebSocket(`${webSocketBaseUrl()}${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(terminalId)}/socket${sizeQuery}`);
}

export function realtimeEvents(machineId = "local", scope: SocketScope = currentApiScope()): WebSocket {
  const path = withManagementEmbedQuery(`${machinePrefix(machineId)}/events`, undefined, scope);
  return new WebSocket(`${webSocketBaseUrl()}${path}`);
}

function machinePrefix(machineId: string): string {
  return `/api/machines/${encodeURIComponent(machineId)}`;
}

function webSocketBaseUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}

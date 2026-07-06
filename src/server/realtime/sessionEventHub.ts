import type { GlobalSessionEvent, RealtimeEvent, SessionUiEvent } from "../../shared/apiTypes.js";
import { NORMAL_SESSION_EVENT_SCOPE, type SessionEventScope } from "./sessionEventScope.js";
export { NORMAL_SESSION_EVENT_SCOPE, type SessionEventScope } from "./sessionEventScope.js";

export interface RealtimeSocket {
  readonly OPEN: number;
  readyState: number;
  send(payload: string): void;
  on(event: "close", listener: () => void): unknown;
}

export class SessionEventHub {
  private readonly socketsBySession = new Map<string, Set<RealtimeSocket>>();
  private readonly globalSocketsByScope = new Map<SessionEventScope, Set<RealtimeSocket>>();

  add(sessionId: string, socket: RealtimeSocket, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const key = sessionScopeKey(sessionId, scope);
    let sockets = this.socketsBySession.get(key);
    if (!sockets) {
      sockets = new Set();
      this.socketsBySession.set(key, sockets);
    }
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  }

  addGlobal(socket: RealtimeSocket, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    let sockets = this.globalSocketsByScope.get(scope);
    if (!sockets) {
      sockets = new Set();
      this.globalSocketsByScope.set(scope, sockets);
    }
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  }

  publish(sessionId: string, event: SessionUiEvent, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const payload = JSON.stringify(event);
    for (const socket of this.socketsBySession.get(sessionScopeKey(sessionId, scope)) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  publishGlobal(event: GlobalSessionEvent, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    this.publishRealtime(event, scope);
  }

  publishRealtime(event: RealtimeEvent, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const payload = JSON.stringify(event);
    for (const socket of this.globalSocketsByScope.get(scope) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}

function sessionScopeKey(sessionId: string, scope: SessionEventScope): string {
  return `${scope}\0${sessionId}`;
}

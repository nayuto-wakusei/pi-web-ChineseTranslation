import type { GlobalSessionEvent, RealtimeEvent, SessionUiEvent } from "../../shared/apiTypes.js";
import { projectBrowserSessionEvent } from "../browserMessageProjection.js";
import { NORMAL_SESSION_EVENT_SCOPE, type SessionEventScope } from "./sessionEventScope.js";
export { NORMAL_SESSION_EVENT_SCOPE, type SessionEventScope } from "./sessionEventScope.js";

export interface RealtimeSocket {
  readonly OPEN: number;
  readyState: number;
  send(payload: string): void;
  terminate(): void;
  on(event: "close", listener: () => void): unknown;
}

export class SessionEventHub {
  private readonly socketsBySession = new Map<string, Set<RealtimeSocket>>();
  private readonly globalSocketsByScope = new Map<SessionEventScope, Set<RealtimeSocket>>();
  private readonly seqBySessionScope = new Map<string, number>();
  private globalJoinFrame: ((scope: SessionEventScope) => RealtimeEvent) | undefined;

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
    const joinFrame = this.globalJoinFrame?.(scope);
    if (joinFrame !== undefined && socket.readyState === socket.OPEN) {
      try { socket.send(JSON.stringify(joinFrame)); }
      catch { sockets.delete(socket); socket.terminate(); }
    }
  }

  setGlobalJoinFrame(frame: (scope: SessionEventScope) => RealtimeEvent): void {
    this.globalJoinFrame = frame;
  }

  publish(sessionId: string, event: SessionUiEvent, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const key = sessionScopeKey(sessionId, scope);
    const seq = (this.seqBySessionScope.get(key) ?? 0) + 1;
    this.seqBySessionScope.set(key, seq);
    const payload = JSON.stringify({ ...projectBrowserSessionEvent(event), seq });
    for (const socket of this.socketsBySession.get(key) ?? []) {
      if (socket.readyState !== socket.OPEN) continue;
      try {
        socket.send(payload);
      } catch {
        this.socketsBySession.get(key)?.delete(socket);
        socket.terminate();
      }
    }
  }

  currentSeq(sessionId: string, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): number {
    return this.seqBySessionScope.get(sessionScopeKey(sessionId, scope)) ?? 0;
  }

  publishGlobal(event: GlobalSessionEvent, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    this.publishRealtime(event, scope);
  }

  publishRealtime(event: RealtimeEvent, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const payload = JSON.stringify(event);
    for (const socket of this.globalSocketsByScope.get(scope) ?? []) {
      if (socket.readyState !== socket.OPEN) continue;
      try {
        socket.send(payload);
      } catch {
        this.globalSocketsByScope.get(scope)?.delete(socket);
        socket.terminate();
      }
    }
  }
}

function sessionScopeKey(sessionId: string, scope: SessionEventScope): string {
  return `${scope}\0${sessionId}`;
}

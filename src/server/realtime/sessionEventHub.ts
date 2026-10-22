import type { GlobalSessionEvent, RealtimeEvent, SessionNotificationSummaryEvent, SessionUiEvent } from "../../shared/apiTypes.js";
import { projectBrowserSessionEvent } from "../browserMessageProjection.js";
import { SESSION_MEDIA_MODE } from "../../shared/sessionMedia.js";
import { SessionMediaIndex, type SessionMediaScope } from "../sessions/sessionMediaIndex.js";
import { NORMAL_SESSION_EVENT_SCOPE, type SessionEventScope } from "./sessionEventScope.js";
export type { SessionEventScope } from "./sessionEventScope.js";

export interface RealtimeSocket {
  readonly OPEN: number;
  readyState: number;
  readonly bufferedAmount?: number;
  send(payload: string): void;
  terminate(): void;
  on(event: "close", listener: () => void): unknown;
}

/** Stop feeding a client that cannot keep up; the next connection gets a fresh snapshot. */
export const REALTIME_SOCKET_HIGH_WATER_MARK = 8 * 1024 * 1024;

export class SessionEventHub {
  private readonly socketsBySession = new Map<string, { inline: Set<RealtimeSocket>; reference: Set<RealtimeSocket> }>();
  private readonly globalSocketsByScope = new Map<SessionEventScope, Set<RealtimeSocket>>();
  private readonly seqBySessionScope = new Map<string, number>();
  private globalJoinFrame: ((scope: SessionEventScope) => RealtimeEvent) | undefined;

  /** The service and routes share this daemon-owned, reconstructible index. */
  constructor(readonly mediaIndex = new SessionMediaIndex()) {}

  add(sessionId: string, socket: RealtimeSocket, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE, mediaMode?: typeof SESSION_MEDIA_MODE): void {
    const key = sessionScopeKey(sessionId, scope);
    let subscribers = this.socketsBySession.get(key);
    if (!subscribers) {
      subscribers = { inline: new Set(), reference: new Set() };
      this.socketsBySession.set(key, subscribers);
    }
    const sockets = mediaMode === SESSION_MEDIA_MODE ? subscribers.reference : subscribers.inline;
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      if (subscribers.inline.size === 0 && subscribers.reference.size === 0) this.socketsBySession.delete(key);
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
    if (joinFrame !== undefined) this.sendToSocket(sockets, socket, JSON.stringify(joinFrame));
  }

  setGlobalJoinFrame(frame: (scope: SessionEventScope) => RealtimeEvent): void {
    this.globalJoinFrame = frame;
  }

  publish(sessionId: string, event: SessionUiEvent, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE, mediaScope?: SessionMediaScope): void {
    const key = sessionScopeKey(sessionId, scope);
    const seq = (this.seqBySessionScope.get(key) ?? 0) + 1;
    this.seqBySessionScope.set(key, seq);
    // Published tools can contain transient images that are not on disk yet.
    const bindingScope = mediaScope === undefined ? undefined : { ...mediaScope, eventScope: scope };
    const referenceEvent = projectBrowserSessionEvent(event, (image) => this.mediaIndex.reference(bindingScope, image));
    const sockets = this.socketsBySession.get(key);
    if (sockets !== undefined && sockets.inline.size > 0) this.sendToSockets(sockets.inline, JSON.stringify({ ...projectBrowserSessionEvent(event), seq }));
    if (sockets !== undefined && sockets.reference.size > 0) this.sendToSockets(sockets.reference, JSON.stringify({ ...referenceEvent, seq }));
  }

  currentSeq(sessionId: string, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): number {
    return this.seqBySessionScope.get(sessionScopeKey(sessionId, scope)) ?? 0;
  }

  publishGlobal(event: GlobalSessionEvent, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    this.publishRealtime(event, scope);
  }

  publishRealtime(event: RealtimeEvent, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    const payload = JSON.stringify(event);
    this.sendToSockets(this.globalSocketsByScope.get(scope), payload);
  }

  publishNotificationSummary(event: SessionNotificationSummaryEvent, scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void {
    this.sendToSockets(this.globalSocketsByScope.get(scope), JSON.stringify(event));
  }

  private sendToSockets(sockets: Set<RealtimeSocket> | undefined, payload: string): void {
    if (sockets === undefined) return;
    for (const socket of sockets) this.sendToSocket(sockets, socket, payload);
  }

  private sendToSocket(sockets: Set<RealtimeSocket>, socket: RealtimeSocket, payload: string): void {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount !== undefined && socket.bufferedAmount > REALTIME_SOCKET_HIGH_WATER_MARK) {
      this.dropSocket(sockets, socket);
      return;
    }
    try {
      socket.send(payload);
    } catch {
      this.dropSocket(sockets, socket);
    }
  }

  private dropSocket(sockets: Set<RealtimeSocket>, socket: RealtimeSocket): void {
    sockets.delete(socket);
    try {
      socket.terminate();
    } catch {
      // Removal is authoritative; cleanup failure must not block healthy sockets.
    }
  }

}

function sessionScopeKey(sessionId: string, scope: SessionEventScope): string {
  return `${scope}\0${sessionId}`;
}

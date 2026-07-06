import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SessionEventHub, type RealtimeSocket } from "./sessionEventHub.js";
import { eventScopeFromManagementContext } from "./sessionEventScope.js";
import type { ManagementEmbedContext } from "../managementEmbed.js";

class FakeSocket extends EventEmitter implements RealtimeSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  send = vi.fn();
}

describe("SessionEventHub", () => {
  it("publishes session events only to sockets for that session", () => {
    const hub = new SessionEventHub();
    const sessionSocket = new FakeSocket();
    const otherSocket = new FakeSocket();
    hub.add("s1", sessionSocket);
    hub.add("s2", otherSocket);

    hub.publish("s1", { type: "assistant.delta", text: "hello" });

    expect(sessionSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "assistant.delta", text: "hello" }));
    expect(otherSocket.send).not.toHaveBeenCalled();
  });

  it("removes session sockets on close and skips non-open sockets", () => {
    const hub = new SessionEventHub();
    const closed = new FakeSocket();
    const removed = new FakeSocket();
    closed.readyState = 3;
    hub.add("s1", closed);
    hub.add("s1", removed);
    removed.emit("close");

    hub.publish("s1", { type: "session.error", message: "boom" });

    expect(closed.send).not.toHaveBeenCalled();
    expect(removed.send).not.toHaveBeenCalled();
  });

  it("publishes global events only to global sockets", () => {
    const hub = new SessionEventHub();
    const globalSocket = new FakeSocket();
    const sessionSocket = new FakeSocket();
    hub.addGlobal(globalSocket);
    hub.add("s1", sessionSocket);

    const status = {
      sessionId: "s1",
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      pendingMessageCount: 0,
      queuedMessages: [],
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    };

    hub.publishGlobal({ type: "status.update", status });

    expect(globalSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "status.update", status }));
    expect(sessionSocket.send).not.toHaveBeenCalled();
  });

  it("keeps session events isolated by scope", () => {
    const hub = new SessionEventHub();
    const normalSocket = new FakeSocket();
    const managementSocket = new FakeSocket();
    hub.add("s1", normalSocket, "normal");
    hub.add("s1", managementSocket, "management:account-1");

    hub.publish("s1", { type: "assistant.delta", text: "normal" }, "normal");
    hub.publish("s1", { type: "assistant.delta", text: "managed" }, "management:account-1");

    expect(normalSocket.send).toHaveBeenCalledTimes(1);
    expect(normalSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "assistant.delta", text: "normal" }));
    expect(managementSocket.send).toHaveBeenCalledTimes(1);
    expect(managementSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "assistant.delta", text: "managed" }));
  });

  it("keeps global events isolated by scope", () => {
    const hub = new SessionEventHub();
    const normalSocket = new FakeSocket();
    const managementSocket = new FakeSocket();
    hub.addGlobal(normalSocket, "normal");
    hub.addGlobal(managementSocket, "management:account-1");

    const normalStatus = {
      sessionId: "s1",
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      pendingMessageCount: 0,
      queuedMessages: [],
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    };
    const managedStatus = { ...normalStatus, pendingMessageCount: 1 };

    hub.publishGlobal({ type: "status.update", status: normalStatus }, "normal");
    hub.publishGlobal({ type: "status.update", status: managedStatus }, "management:account-1");

    expect(normalSocket.send).toHaveBeenCalledTimes(1);
    expect(normalSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "status.update", status: normalStatus }));
    expect(managementSocket.send).toHaveBeenCalledTimes(1);
    expect(managementSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "status.update", status: managedStatus }));
  });

  it("changes management event scope when runtime permissions or sandbox interpreter change", () => {
    const base = managementContext();
    const withDifferentTools = managementContext({ tools: { allow: ["read"], deny: ["python"], permissions: { "tools:execute": true } } });
    const withDifferentSandbox = managementContext({ sandbox: { pythonExecutable: "/opt/python/bin/python3", env: { MODEL_TOKEN: "redacted" } } });

    expect(eventScopeFromManagementContext(withDifferentTools)).not.toBe(eventScopeFromManagementContext(base));
    expect(eventScopeFromManagementContext(withDifferentSandbox)).not.toBe(eventScopeFromManagementContext(base));
  });
});

function managementContext(patch: Partial<ManagementEmbedContext> = {}): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["runtime:read"] },
    projects: [{ id: "project-1", name: "Project 1", root: "/projects/project-1" }],
    ...patch,
  };
}

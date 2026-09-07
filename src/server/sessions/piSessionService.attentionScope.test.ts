import { resolve } from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";
import { eventScopeFromManagementContext } from "../realtime/sessionEventScope.js";
import { PiSessionService } from "./piSessionService.js";
import { emptyArchiveStore, fakeRuntime, ScopeCapturingSessionEventHub, sessionGateway, testModelRuntime } from "./piSessionService.testSupport.js";
import { registerSessionRoutes } from "./sessionRoutes.js";

const cwd = resolve("/workspace");
const ref = { id: "shared-session", cwd };
const contexts: (ManagementEmbedContext | undefined)[] = [undefined, context("a"), context("b")];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe("session attention ownership", () => {
  it("isolates HTTP catalogs, inboxes and dismissal despite identical session ids and cwd", async () => {
    const { service, app } = await harness();
    for (const owner of contexts) {
      const response = await app.inject({ url: `/sessions/${ref.id}/notifications?cwd=${encodeURIComponent(cwd)}`, headers: headers(owner) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ notifications: [{ message: owner?.user.id ?? "normal" }], summary: { retainedCount: 1 } });
      const catalog = await app.inject({ url: "/sessions/notifications", headers: headers(owner) });
      expect(catalog.json()).toEqual(service.notificationCatalog(owner));
    }

    const normal = service.notificationInbox(ref);
    const owner = contexts[1];
    const owned = service.notificationInbox(ref, owner);
    const foreignDismiss = await app.inject({
      method: "POST", url: `/sessions/${ref.id}/notifications/dismiss`, headers: headers(owner),
      payload: { cwd, daemonInstanceId: normal.daemonInstanceId, notificationId: normal.notifications[0]?.id },
    });
    expect(foreignDismiss.statusCode).toBe(200);
    expect(service.notificationInbox(ref)).toEqual(normal);
    expect(service.notificationInbox(ref, owner)).toEqual(owned);

    const dismissed = await app.inject({
      method: "POST", url: `/sessions/${ref.id}/notifications/dismiss-all`, headers: headers(owner),
      payload: { cwd, daemonInstanceId: owned.daemonInstanceId, throughOrder: owned.dismissThrough.order, throughOverflowWatermark: owned.dismissThrough.overflowWatermark },
    });
    expect(dismissed.statusCode).toBe(200);
    expect(service.notificationInbox(ref, owner).notifications).toEqual([]);
    expect(service.notificationInbox(ref).notifications).toHaveLength(1);
    expect(service.notificationInbox(ref, contexts[2]).notifications).toHaveLength(1);
    const other = service.notificationInbox(ref, contexts[2]);
    const singleDismissed = await app.inject({
      method: "POST", url: `/sessions/${ref.id}/notifications/dismiss`, headers: headers(contexts[2]),
      payload: { cwd, daemonInstanceId: other.daemonInstanceId, notificationId: other.notifications[0]?.id },
    });
    expect(singleDismissed.statusCode).toBe(200);
    expect(service.notificationInbox(ref, contexts[2]).notifications).toEqual([]);
    expect(service.notificationInbox(ref).notifications).toHaveLength(1);
  });

  it("keeps unread epochs, acknowledgements and closed-runtime catalogs in their originating scope", async () => {
    const { service, app, runtimes } = await harness();
    runtimes.forEach(complete);
    const normal = await service.unreadCatalog();
    const owner = contexts[1];
    const owned = await service.unreadCatalog(owner);
    expect(owned.catalogId).not.toBe(normal.catalogId);
    expect(owned.sessions).toHaveLength(1);
    for (const candidate of contexts) {
      const response = await app.inject({ url: "/sessions/unread", headers: headers(candidate) });
      expect(response.json()).toEqual(await service.unreadCatalog(candidate));
    }

    await service.stop(ref, owner);
    expect(await service.unreadCatalogForScope(eventScopeFromManagementContext(owner))).toEqual(owned);
    const acknowledge = (catalogId: string) => app.inject({
      method: "POST", url: `/sessions/${ref.id}/unread/acknowledge`, headers: headers(owner),
      payload: { cwd, catalogId, throughCompletionOrder: owned.sessions[0]?.completionOrder },
    });
    await acknowledge(normal.catalogId);
    expect(await service.unreadCatalog(owner)).toEqual(owned);
    const cleared = await acknowledge(owned.catalogId);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ sessions: [] });
    expect(await service.unreadCatalog()).toEqual(normal);
    expect((await service.unreadCatalog(contexts[2])).sessions).toHaveLength(1);
  });

  it("routes startup notifications and delayed unread publication to exactly one scope", async () => {
    const { service, hub, runtimes } = await harness();
    for (const [index, runtime] of runtimes.entries()) {
      const scope = eventScopeFromManagementContext(contexts[index]);
      const message = contexts[index]?.user.id ?? "normal";
      expect(hub.sessionEvents.filter(({ event }) => event.type === "command.output" && event.message === message).map(({ scope }) => scope)).toEqual([scope]);
      complete(runtime);
      await service.unreadCatalog(contexts[index]);
    }
    expect(hub.globalEvents.filter(({ event }) => event.type === "notifications.summary").map(({ scope }) => scope)).toEqual(contexts.map(eventScopeFromManagementContext));
    expect(hub.globalEvents.filter(({ event }) => event.type === "sessions.unread").map(({ scope }) => scope)).toEqual(contexts.map(eventScopeFromManagementContext));

    const owner = contexts[1];
    const runtime = runtimes[1];
    if (runtime === undefined) throw new Error("Missing managed runtime");
    const ui = runtime.session.extensionRunner.getUIContext();
    const oldNotify = ui.notify.bind(ui);
    await service.stop(ref, owner);
    const count = hub.sessionEvents.length;
    oldNotify("stale managed notification", "error");
    expect(hub.sessionEvents).toHaveLength(count);
    expect(service.notificationInbox(ref).notifications).toHaveLength(1);
  });

  it("rejects an inbox owned only by a different management context", async () => {
    const { service } = await harness();
    const stranger = context("stranger");
    expect(service.notificationCatalog(stranger).sessions).toEqual([]);
    expect(() => service.notificationInbox(ref, stranger)).toThrow("Session not found");
    expect((await service.unreadCatalog(stranger)).sessions).toEqual([]);
  });

  it("keeps management reload generations separate from a same-id normal runtime", async () => {
    const { service, runtimes } = await harness();
    const owner = contexts[1];
    const runtime = runtimes[1];
    if (runtime === undefined) throw new Error("Missing managed runtime");
    const ui = runtime.session.extensionRunner.getUIContext();
    const oldNotify = ui.notify.bind(ui);
    runtime.session.reload = async (options) => {
      await options?.beforeSessionStart?.();
      runtime.session.extensionRunner.getUIContext().notify("managed replacement", "warning");
    };

    await expect(service.runCommand(ref, "/reload", owner)).resolves.toMatchObject({ type: "done" });

    oldNotify("old managed generation", "error");
    expect(service.notificationInbox(ref, owner).notifications.map((entry) => entry.message)).toEqual(["managed replacement"]);
    expect(service.notificationInbox(ref).notifications.map((entry) => entry.message)).toEqual(["normal"]);
    expect(service.notificationInbox(ref, contexts[2]).notifications.map((entry) => entry.message)).toEqual(["b"]);
  });

  it("retains tracked management-child notifications without adding the child to unread catalogs", async () => {
    const owner = context("parent-owner");
    const parent = fakeRuntime("parent");
    const child = fakeRuntime("child");
    const hub = new ScopeCapturingSessionEventHub();
    const runtimes = [parent.runtime, child.runtime];
    const service = new PiSessionService(hub, {
      modelRuntime: testModelRuntime, agentDir: "/tmp/pi-web-test-agent", heartbeatIntervalMs: 60_000,
      archiveStore: emptyArchiveStore(), sessionManager: sessionGateway([]),
      spawnTargets: { resolveSpawnTarget: () => Promise.resolve({ allowed: true, cwd: "/workspace" }) },
      createAgentRuntime: () => {
        const runtime = runtimes.shift();
        if (runtime === undefined) throw new Error("Unexpected runtime creation");
        return Promise.resolve(runtime);
      },
    });
    cleanups.push(() => service.dispose());
    await service.start("/workspace", { managementContext: owner });
    await service.spawnSubsession({ spawningCwd: "/workspace", parentSessionId: "parent", parentSessionFile: parent.session.sessionFile, prompt: "child task", managementContext: owner });
    child.session.extensionRunner.getUIContext().notify("managed child notice", "info");
    complete(child);
    await vi.waitFor(() => { expect(parent.calls.sendCustomMessage).toHaveLength(1); });

    expect((await service.unreadCatalog(owner)).sessions.map((entry) => entry.sessionId)).toEqual(["parent"]);
    expect((await service.unreadCatalog()).sessions).toEqual([]);
    expect(service.notificationInbox({ id: "child", cwd }, owner).notifications.map((entry) => entry.message)).toEqual(["managed child notice"]);
    expect(service.notificationCatalog().sessions).toEqual([]);
    expect(hub.globalEvents.filter(({ event }) => event.type === "notifications.summary").every(({ scope }) => scope === eventScopeFromManagementContext(owner))).toBe(true);
  });
});

async function harness() {
  const hub = new ScopeCapturingSessionEventHub();
  const runtimes = contexts.map((owner) => fakeRuntime(ref.id, {
    bindExtensions: (bindings) => {
      bindings.uiContext?.notify(owner?.user.id ?? "normal", "info");
      return Promise.resolve();
    },
  }));
  const service = new PiSessionService(hub, {
    modelRuntime: testModelRuntime, agentDir: "/tmp/pi-web-test-agent", heartbeatIntervalMs: 60_000,
    archiveStore: emptyArchiveStore(), sessionManager: sessionGateway([]),
    createAgentRuntime: (_factory, { managementContext }) => {
      const index = contexts.findIndex((owner) => owner?.user.id === managementContext?.user.id);
      const runtime = runtimes[index];
      if (runtime === undefined) throw new Error("Unknown test owner");
      // Keep the real fake-runtime binding behavior while emitting during startup.
      const original = runtime.session.bindExtensions.bind(runtime.session);
      runtime.session.bindExtensions = async (bindings) => {
        runtime.session.extensionRunner.setUIContext(bindings.uiContext, "rpc");
        await original(bindings);
      };
      return Promise.resolve(runtime.runtime);
    },
  });
  const app = Fastify();
  await app.register(websocket);
  registerSessionRoutes(app, service, hub);
  cleanups.push(async () => { await app.close(); await service.dispose(); });
  for (const owner of contexts) await service.start(cwd, owner === undefined ? undefined : { managementContext: owner });
  return { service, app, runtimes, hub };
}

function complete(runtime: ReturnType<typeof fakeRuntime>): void {
  runtime.session.isStreaming = true;
  runtime.emit({ type: "agent_start" });
  runtime.session.isStreaming = false;
  runtime.emit({ type: "turn_end" });
}

function context(id: string): ManagementEmbedContext {
  return { user: { id, rootUserId: id, roles: [], permissions: [] }, projects: [{ id: "shared", name: "Shared", root: cwd }] };
}

function headers(owner: ManagementEmbedContext | undefined): Record<string, string> {
  return owner === undefined ? {} : { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(owner) };
}

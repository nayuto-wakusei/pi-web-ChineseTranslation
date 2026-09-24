import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, WorkspaceProviderAuthorityResolution } from "../../shared/apiTypes.js";
import { SessionUnreadStore, type SessionUnreadMutation } from "../sessions/sessionUnreadStore.js";
import { ProjectLifecycleService } from "./projectLifecycleService.js";

const REMOVED = project("removed", "/srv/removed");
const KEPT = project("kept", "/srv/kept");
const CLEANUP_DELAY = 60_000;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("ProjectLifecycleService", () => {
  it("coalesces cleanup signals and removes only unread outside authoritative workspace paths", async () => {
    const fixture = lifecycle([KEPT]);
    complete(fixture.unread, "orphan", REMOVED.path);
    complete(fixture.unread, "retained", KEPT.path);

    fixture.service.scheduleCleanup();
    fixture.service.scheduleCleanup();
    await vi.advanceTimersByTimeAsync(CLEANUP_DELAY - 1);
    expect(fixture.workspaces.resolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(fixture.projects.list).toHaveBeenCalledOnce();
    expect(fixture.workspaces.resolve).toHaveBeenCalledOnce();
    expect(fixture.unread.catalogSnapshot().sessions.map(({ sessionId }) => sessionId)).toEqual(["retained"]);
    expect(fixture.mutations[0]?.event).toMatchObject({ sessionId: "orphan", cwd: REMOVED.path, unread: null });

    await vi.advanceTimersByTimeAsync(CLEANUP_DELAY * 2);
    expect(fixture.reconcile).toHaveBeenCalledOnce();
  });

  it("skips workspace discovery while the unread catalog is empty", async () => {
    const fixture = lifecycle([KEPT]);
    fixture.service.scheduleCleanup();
    await fixture.service.close(KEPT.id);
    await fixture.service.add({ path: REMOVED.path });
    await vi.advanceTimersByTimeAsync(CLEANUP_DELAY * 2);

    expect(fixture.projects.list).not.toHaveBeenCalled();
    expect(fixture.workspaces.resolve).not.toHaveBeenCalled();
    expect(fixture.reconcile).not.toHaveBeenCalled();
  });

  it("cleans removed-project unread before a quick re-add", async () => {
    const fixture = lifecycle([REMOVED, KEPT]);
    complete(fixture.unread, "old", REMOVED.path);

    await fixture.service.close(REMOVED.id);
    expect(fixture.unread.hasUnread()).toBe(true);
    await fixture.service.add({ path: REMOVED.path });

    expect(fixture.reconcile).toHaveBeenCalledOnce();
    expect(fixture.unread.hasUnread()).toBe(false);
    expect(fixture.projects.add).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(CLEANUP_DELAY * 2);
    expect(fixture.reconcile).toHaveBeenCalledOnce();
  });

  it("preserves shared workspaces when reconciling a removed project", async () => {
    const sharedPath = "/srv/shared";
    const fixture = lifecycle([REMOVED, KEPT], new Map([
      [REMOVED.id, [REMOVED.path, sharedPath]],
      [KEPT.id, [KEPT.path, sharedPath]],
    ]));
    complete(fixture.unread, "removed", REMOVED.path);
    complete(fixture.unread, "shared", sharedPath);

    await fixture.service.close(REMOVED.id);
    await vi.advanceTimersByTimeAsync(CLEANUP_DELAY);

    expect(fixture.unread.catalogSnapshot().sessions.map(({ sessionId }) => sessionId)).toEqual(["shared"]);
  });

  it.each([
    ["provider failure", () => Promise.reject(new Error("workspace provider unavailable"))],
    ["degraded resolution", (owner: Project) => Promise.resolve({ ...resolution(owner), status: "degraded" as const })],
    ["diagnostics", (owner: Project) => Promise.resolve({ ...resolution(owner), diagnostics: [{ code: "probe-failed" as const, message: "failed", tier: "primary" as const }] })],
  ])("retries %s without deleting unread state", async (_label, failedResolution) => {
    const fixture = lifecycle([KEPT]);
    complete(fixture.unread, "orphan", REMOVED.path);
    fixture.workspaces.resolve.mockImplementationOnce(failedResolution);
    fixture.service.scheduleCleanup();

    await vi.advanceTimersByTimeAsync(CLEANUP_DELAY);
    expect(fixture.unread.hasUnread()).toBe(true);
    expect(fixture.reconcile).not.toHaveBeenCalled();
    expect(fixture.logger.warn).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(CLEANUP_DELAY);
    expect(fixture.unread.hasUnread()).toBe(false);
    expect(fixture.reconcile).toHaveBeenCalledOnce();
  });

  it("does not add a project when durable cleanup fails, then retries before a later add", async () => {
    const fixture = lifecycle([KEPT]);
    complete(fixture.unread, "orphan", REMOVED.path);
    fixture.reconcile.mockImplementationOnce((cwds) => {
      fixture.mutations.push(...fixture.unread.reconcileWorkspaces(cwds));
      return Promise.reject(new Error("disk full"));
    });

    await expect(fixture.service.add({ path: REMOVED.path })).rejects.toThrow("disk full");
    expect(fixture.projects.add).not.toHaveBeenCalled();
    expect(fixture.unread.hasUnread()).toBe(false);

    await vi.advanceTimersByTimeAsync(CLEANUP_DELAY);
    await fixture.service.add({ path: REMOVED.path });
    expect(fixture.projects.add).toHaveBeenCalledOnce();
    expect(fixture.reconcile).toHaveBeenCalledTimes(2);
  });

  it("waits for serialized cleanup before adding a project and stops timers on shutdown", async () => {
    const fixture = lifecycle([KEPT]);
    complete(fixture.unread, "orphan", REMOVED.path);
    const gate = deferred<WorkspaceProviderAuthorityResolution>();
    fixture.workspaces.resolve.mockReturnValueOnce(gate.promise);

    const adding = fixture.service.add({ path: REMOVED.path });
    await Promise.resolve();
    expect(fixture.projects.add).not.toHaveBeenCalled();
    gate.resolve(resolution(KEPT));
    await adding;
    expect(fixture.projects.add).toHaveBeenCalledOnce();

    complete(fixture.unread, "another-orphan", "/srv/another");
    fixture.service.scheduleCleanup();
    await fixture.service.closeAll();
    await vi.advanceTimersByTimeAsync(CLEANUP_DELAY);
    await expect(fixture.service.add({ path: "/srv/other" })).rejects.toThrow("shutting down");
    expect(fixture.projects.list).toHaveBeenCalledOnce();
  });
});

function lifecycle(initial: Project[], paths = new Map<string, string[]>()) {
  let registered = [...initial];
  const projects = {
    list: vi.fn(() => Promise.resolve([...registered])),
    add: vi.fn((input: { path: string }) => {
      const added = project(`new-${String(registered.length)}`, input.path);
      registered.push(added);
      return Promise.resolve(added);
    }),
    close: vi.fn((id: string) => {
      const next = registered.filter((entry) => entry.id !== id);
      if (next.length === registered.length) return Promise.reject(new Error("Project not found"));
      registered = next;
      return Promise.resolve();
    }),
  };
  const workspaces = {
    resolve: vi.fn((owner: Project) => Promise.resolve(resolution(owner, paths.get(owner.id) ?? [owner.path]))),
  };
  const unread = new SessionUnreadStore();
  const mutations: SessionUnreadMutation[] = [];
  const reconcile = vi.fn(async (cwds: Iterable<string>) => {
    mutations.push(...unread.reconcileWorkspaces(cwds));
    await unread.flush();
  });
  const logger = { warn: vi.fn() };
  const service = new ProjectLifecycleService({
    projects,
    workspaces,
    hasUnread: () => unread.hasUnread(),
    reconcileUnreadWorkspaces: reconcile,
    onProjectsChanged: vi.fn(),
    logger,
  });
  return { service, projects, workspaces, unread, mutations, reconcile, logger };
}

function project(id: string, path: string): Project {
  return { id, path, name: id, createdAt: "2026-09-01T00:00:00Z" };
}

function resolution(owner: Project, paths = [owner.path]): WorkspaceProviderAuthorityResolution {
  return {
    projectId: owner.id,
    status: "folder",
    diagnostics: [],
    workspaces: paths.map((path) => ({ id: path, projectId: owner.id, path, isMain: path === owner.path, label: path })),
  };
}

function complete(store: SessionUnreadStore, sessionId: string, cwd: string): void {
  store.observeActivityState(sessionId, cwd, true);
  store.observeActivityState(sessionId, cwd, false);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((completePromise) => { resolve = completePromise; });
  return { promise, resolve };
}

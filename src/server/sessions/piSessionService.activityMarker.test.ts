import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { SessionActivityMarker } from "./sessionActivityMarker.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRef, testManagementContext, testModelRuntime } from "./piSessionService.testSupport.js";

const ACTIVITY_WARNING = {
  severity: "info",
  message: "此会话最近在另一个 PI WEB 实例中活动。请避免在两个实例中同时操作此会话。",
  source: "PI-WEB",
};

describe("PiSessionService advisory activity across instances", () => {
  let directory: string;
  let file: string;
  let sidecar: string;
  let now: number;
  let services: PiSessionService[];

  function service(fake = fakeRuntime("session-1", { sessionFile: file }), hub = new CapturingSessionEventHub()) {
    const instance = new PiSessionService(hub, {
      agentDir: directory,
      dataDir: directory,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 2_000,
      now: () => new Date(now),
    });
    services.push(instance);
    return instance;
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "pi-web-instance-activity-"));
    file = join(directory, "session.jsonl");
    sidecar = `${file}.pi-web-activity.json`;
    await writeFile(file, '{"type":"session","id":"session-1"}\n');
    now = 100_000;
    services = [];
  });

  afterEach(async () => {
    await Promise.all(services.map((instance) => instance.dispose()));
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("projects a foreign owner's presence as informational warnings without locking or claiming the session", async () => {
    const marker = JSON.stringify({ owner: "foreign-instance", updatedAt: now });
    await writeFile(sidecar, marker);
    const fake = fakeRuntime("session-1", { sessionFile: file });
    const instance = service(fake);
    await instance.start("/workspace");
    expect((await instance.status(sessionRef("session-1"))).warnings).toContainEqual(ACTIVITY_WARNING);
    await instance.prompt(sessionRef("session-1"), "A controlled prompt with no real model");
    expect(fake.calls.prompt).toEqual([{ text: "A controlled prompt with no real model", options: undefined }]);
    expect(await readFile(sidecar, "utf8")).toBe(marker);
    expect(instance.activeCount()).toBe(1);
  });

  it("refreshes idle observers on heartbeats and republishes warning changes and expiry", async () => {
    vi.useFakeTimers();
    const hub = new CapturingSessionEventHub();
    const instance = service(undefined, hub);
    await instance.start("/workspace");
    await instance.status(sessionRef("session-1"));
    await writeFile(sidecar, JSON.stringify({ owner: "foreign-instance", updatedAt: now }));
    now += 2_000;
    await vi.advanceTimersByTimeAsync(2_000);
    await instance.status(sessionRef("session-1"));
    expect(hub.globalEvents.some((event) => event.type === "status.update"
      && event.status.warnings?.some((warning) => warning.message === ACTIVITY_WARNING.message) === true)).toBe(true);
    now += 16_000;
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await instance.status(sessionRef("session-1"))).warnings ?? []).toEqual([]);
    expect(hub.globalEvents.filter((event) => event.type === "status.update").at(-1)).not.toHaveProperty("status.warnings");
  });

  it("writes presence for busy sessions and releases it on idle, stop and service disposal", async () => {
    const fake = fakeRuntime("session-1", { sessionFile: file, isStreaming: true });
    const instance = service(fake);
    await instance.start("/workspace");
    await instance.status(sessionRef("session-1"));
    expect(JSON.parse(await readFile(sidecar, "utf8"))).toMatchObject({ updatedAt: now });
    fake.session.isStreaming = false;
    await instance.status(sessionRef("session-1"));
    await expect(stat(sidecar)).rejects.toMatchObject({ code: "ENOENT" });
    fake.session.isStreaming = true;
    await instance.status(sessionRef("session-1"));
    await instance.stop(sessionRef("session-1"));
    await expect(stat(sidecar)).rejects.toMatchObject({ code: "ENOENT" });
    const other = service(fakeRuntime("other", { sessionFile: file, isStreaming: true }));
    await other.start("/workspace");
    await other.status(sessionRef("other"));
    await other.dispose();
    await expect(stat(sidecar)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never reads, projects, writes or releases normal sidecars for management-scoped sessions", async () => {
    const marker = JSON.stringify({ owner: "foreign-instance", updatedAt: now });
    await writeFile(sidecar, marker);
    const refresh = vi.spyOn(SessionActivityMarker.prototype, "refresh");
    const release = vi.spyOn(SessionActivityMarker.prototype, "release");
    const fake = fakeRuntime("session-1", { sessionFile: file, isStreaming: true });
    const instance = service(fake);
    const context = testManagementContext();
    await instance.start("/workspace", { managementContext: context });
    expect((await instance.status(sessionRef("session-1"), context)).warnings ?? []).toEqual([]);
    await instance.stop(sessionRef("session-1"), context);
    expect(refresh).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(await readFile(sidecar, "utf8")).toBe(marker);
  });
});

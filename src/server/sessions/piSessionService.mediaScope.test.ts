import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../../shared/i18n.js";
import { eventScopeFromManagementContext } from "../realtime/sessionEventScope.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { PiSessionService } from "./piSessionService.js";
import { emptyArchiveStore, fakeRuntime, fakeSessionManager, sessionGateway, sessionRecord, sessionRef, testManagementContext, testModelRuntime, type RuntimeCreator } from "./piSessionService.testSupport.js";

const image = (text: string) => ({ type: "image", mimeType: "image/png", data: Buffer.from(text).toString("base64") });
const mediaId = (block: ReturnType<typeof image>) => createHash("sha256").update(`image/png\0${block.data}`).digest("hex");
const entries = (text: string) => [{ type: "message", message: { role: "user", content: [image(text)] } }];
const services: PiSessionService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.dispose())); });

function runtime(file: string, text: string, cwd = "/workspace") {
  return fakeRuntime("shared-session", { sessionFile: file, sessionManager: fakeSessionManager(cwd, {
    getSessionId: () => "shared-session", getSessionFile: () => file, getEntries: () => entries(text),
  }) });
}

function fixture(options: { normalFile?: string; normalCwd?: string } = {}) {
  const context = testManagementContext();
  const secondContext = { ...context, user: { ...context.user, id: "account-2", rootUserId: "root-2" } };
  const normal = runtime(options.normalFile ?? "/sessions/normal.jsonl", "normal", options.normalCwd);
  const managed = runtime("/sessions/managed.jsonl", "managed");
  const second = runtime("/sessions/managed-second.jsonl", "second");
  const readEntries = vi.fn((path: string) => Promise.resolve(entries(path === managed.session.sessionFile ? "managed" : path === second.session.sessionFile ? "second" : "normal")));
  const create = vi.fn<RuntimeCreator>((_factory, options) => Promise.resolve(options.managementContext === undefined ? normal.runtime : options.managementContext.user.id === context.user.id ? managed.runtime : second.runtime));
  const hub = new SessionEventHub();
  const archiveStore = emptyArchiveStore();
  const gateway = {
    ...sessionGateway([
      { ...sessionRecord("shared-session", options.normalCwd ?? "/workspace"), path: options.normalFile ?? "/sessions/normal.jsonl" },
      ...(options.normalCwd === undefined ? [] : [{ ...sessionRecord("shared-session"), path: "/sessions/managed.jsonl" }]),
    ]),
    readEntries,
  };
  const service = new PiSessionService(hub, {
    projectPathForCwd: (cwd) => Promise.resolve(cwd === (options.normalCwd ?? "/workspace") ? cwd : undefined),
    translator: createTranslator("en", {}), modelRuntime: testModelRuntime, managementModelRuntime: testModelRuntime,
    archiveStore, createAgentRuntime: create, sessionManager: gateway, heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  return { service, context, secondContext, managed, second, normal, create, hub, readEntries, archiveStore };
}

describe("media session ownership", () => {
  it("keeps startup media reachable only by the owning management scope", async () => {
    const f = fixture();
    const ref = sessionRef("shared-session");
    let entered!: () => void;
    let release!: () => void;
    const binding = new Promise<void>((resolve) => { entered = resolve; });
    const ready = new Promise<void>((resolve) => { release = resolve; });
    f.managed.session.bindExtensions = () => { entered(); return ready; };
    const opening = f.service.status(ref, f.context);
    await binding;
    try {
      await expect(f.service.media(ref, mediaId(image("managed")))).rejects.toThrow("Session not found");
      expect(await f.service.media(ref, mediaId(image("managed")), f.context)).toMatchObject({ data: Buffer.from("managed") });
      expect(f.create).toHaveBeenCalledOnce();
    } finally { release(); await opening; }
  });

  it("does not infer management ownership from a cold file or cached media", async () => {
    const f = fixture();
    const ref = sessionRef("shared-session");
    f.hub.mediaIndex.reference({ ...ref, eventScope: eventScopeFromManagementContext(f.context) }, image("managed"));
    await expect(f.service.media(ref, mediaId(image("managed")), f.context)).rejects.toThrow("Session not found");
    expect(f.create).not.toHaveBeenCalled();
    expect(f.readEntries).not.toHaveBeenCalled();
  });

  it("rejects another scope before consulting an ordinary cache, including after the management runtime closes", async () => {
    const f = fixture({ normalFile: "/sessions/managed.jsonl" });
    const ref = sessionRef("shared-session");
    await f.service.status(ref, f.context);
    f.hub.mediaIndex.reference(ref, image("managed"));
    await expect(f.service.media(ref, mediaId(image("managed")))).rejects.toThrow("Session not found");
    await f.service.stop(ref, f.context);
    await expect(f.service.media(ref, mediaId(image("managed")))).rejects.toThrow("Session not found");
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.readEntries).not.toHaveBeenCalled();
  });

  it("does not hide an ordinary cold copy with the same id in a different workspace", async () => {
    const f = fixture({ normalCwd: "/other-workspace" });
    await f.service.status(sessionRef("shared-session"), f.context);
    expect(await f.service.media(sessionRef("shared-session", "/other-workspace"), mediaId(image("normal"))))
      .toMatchObject({ data: Buffer.from("normal"), mimeType: "image/png" });
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.readEntries).toHaveBeenCalledExactlyOnceWith("/sessions/normal.jsonl");
  });

  it("does not lose known management ownership when the archive records its original path", async () => {
    const f = fixture();
    const ref = sessionRef("shared-session");
    await f.service.status(ref, f.context);
    await f.service.stop(ref, f.context);
    f.archiveStore.get = () => Promise.resolve({ sessionId: ref.id, cwd: ref.cwd, archivedAt: "2026-01-01T00:00:00.000Z", originalPath: "/sessions/managed.jsonl", archivePath: "/archives/managed.jsonl" });
    await expect(f.service.media(ref, mediaId(image("managed")))).rejects.toThrow("Session not found");
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.readEntries).not.toHaveBeenCalled();
  });

  it("separates same-id, same-workspace runtimes backed by different files", async () => {
    const f = fixture();
    const ref = sessionRef("shared-session");
    await f.service.status(ref);
    await f.service.status(ref, f.context);
    expect(await f.service.media(ref, mediaId(image("normal")))).toMatchObject({ data: Buffer.from("normal") });
    expect(await f.service.media(ref, mediaId(image("managed")), f.context)).toMatchObject({ data: Buffer.from("managed") });
    expect(await f.service.media(ref, mediaId(image("managed")))).toBeUndefined();
    expect(f.create).toHaveBeenCalledTimes(2);
  });

  it("does not reuse another management identity's runtime, source binding or file", async () => {
    const f = fixture();
    const ref = sessionRef("shared-session");
    await f.service.status(ref, f.context);
    await expect(f.service.media(ref, mediaId(image("managed")), f.secondContext)).rejects.toThrow("Session not found");
    await f.service.status(ref, f.secondContext);
    expect(await f.service.media(ref, mediaId(image("managed")), f.context)).toMatchObject({ data: Buffer.from("managed") });
    expect(await f.service.media(ref, mediaId(image("second")), f.secondContext)).toMatchObject({ data: Buffer.from("second") });
    expect(await f.service.media(ref, mediaId(image("managed")), f.secondContext)).toBeUndefined();
    expect(f.create).toHaveBeenCalledTimes(2);
  });
});

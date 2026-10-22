import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../../shared/i18n.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { PiSessionService, type PiSessionServiceDependencies } from "./piSessionService.js";
import { emptyArchiveStore, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, testManagementContext, testModelRuntime } from "./piSessionService.testSupport.js";

const block = { type: "image", mimeType: "image/png", data: Buffer.from("private image").toString("base64") };
const mediaId = createHash("sha256").update(`image/png\0${block.data}`).digest("hex");
const entries = [{ type: "message", message: { role: "user", content: [block] } }];
let directory: string;
const services: PiSessionService[] = [];
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "pi-web-session-read-")); });
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await rm(directory, { recursive: true, force: true });
});

function fixture(cwd: string, options: {
  authority?: "absent" | "undefined" | "throws";
  managementRoot?: string;
  archived?: boolean;
} = {}) {
  const ref = { id: "session-1", cwd };
  const record = { ...sessionRecord(ref.id, cwd), path: join(directory, "session.jsonl") };
  const gateway = { ...sessionGateway([record]), readEntries: vi.fn(() => Promise.resolve(entries)) };
  const list = vi.spyOn(gateway, "list");
  const resolveFile = vi.spyOn(gateway, "resolveSessionFile");
  const archive = { sessionId: ref.id, cwd, archivedAt: "now", originalPath: record.path, archivePath: join(directory, "archived.jsonl"), firstMessage: "private text" };
  const archiveStore = {
    ...emptyArchiveStore(),
    get: vi.fn(() => Promise.resolve(options.archived === true ? archive : undefined)),
    list: vi.fn(() => Promise.resolve(options.archived === true ? [archive] : [])),
  };
  const authority = vi.fn<NonNullable<PiSessionServiceDependencies["projectPathForCwd"]>>((requested) => {
    if (options.authority === "throws") return Promise.reject(new Error("Ambiguous project"));
    return Promise.resolve(options.authority === "undefined" || requested !== cwd ? undefined : cwd);
  });
  const runtime = fakeRuntime(ref.id, { sessionFile: record.path, sessionManager: fakeSessionManager(cwd, { getSessionId: () => ref.id, getEntries: () => entries }) });
  const createRuntime = vi.fn(runtimeCreator(runtime.runtime));
  const modelRuntime = vi.fn(() => Promise.reject(new Error("Must not initialize credentials")));
  const hub = new SessionEventHub();
  const service = new PiSessionService(hub, {
    agentDir: directory, translator: createTranslator("en", {}), modelRuntime: testModelRuntime,
    normalModelRuntimeForCwd: modelRuntime, createAgentRuntime: createRuntime, sessionManager: gateway,
    archiveStore, heartbeatIntervalMs: 60_000,
    ...(options.authority === "absent" ? {} : { projectPathForCwd: authority }),
    ...(options.managementRoot === undefined ? {} : { managementProjectRoot: options.managementRoot }),
  });
  services.push(service);
  return { service, ref, hub, authority, modelRuntime, createRuntime, gateway, archiveStore, list, resolveFile };
}

describe("normal session read authority", () => {
  it.each(["absent", "undefined", "throws"] as const)("fails closed for %s project authority before storage or cached media", async (authority) => {
    const f = fixture(join(directory, "normal"), { authority });
    f.hub.mediaIndex.reference(f.ref, block);
    await expect(f.service.media(f.ref, mediaId)).rejects.toThrow("Session not found");
    await expect(f.service.listCatalogSessions(f.ref.cwd)).rejects.toThrow("Session not found");
    expect(f.resolveFile).not.toHaveBeenCalled();
    expect(f.list).not.toHaveBeenCalled();
    expect(f.archiveStore.get).not.toHaveBeenCalled();
    expect(f.archiveStore.list).not.toHaveBeenCalled();
    expect(f.modelRuntime).not.toHaveBeenCalled();
    expect(f.createRuntime).not.toHaveBeenCalled();
  });

  it.each([false, true])("excludes a registered management cwd from a fresh service, including archives: %s", async (archived) => {
    const root = join(directory, "managed");
    const f = fixture(join(root, "user", "project"), { managementRoot: root, archived });
    await expect(f.service.media(f.ref, mediaId)).rejects.toThrow("Session not found");
    await expect(f.service.listCatalogSessions(f.ref.cwd)).rejects.toThrow("Session not found");
    expect(f.resolveFile).not.toHaveBeenCalled();
    expect(f.list).not.toHaveBeenCalled();
    expect(f.archiveStore.get).not.toHaveBeenCalled();
    expect(f.archiveStore.list).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps authorized ordinary cold reads without credential or runtime initialization, archived: %s", async (archived) => {
    const f = fixture(join(directory, "normal"), { managementRoot: join(directory, "managed"), archived });
    expect(await f.service.media(f.ref, mediaId)).toEqual({ data: Buffer.from(block.data, "base64"), mimeType: "image/png" });
    expect(await f.service.listCatalogSessions(f.ref.cwd)).toEqual([{ id: f.ref.id, cwd: f.ref.cwd, archived, runtime: "not-hosted" }]);
    expect(f.modelRuntime).not.toHaveBeenCalled();
    expect(f.createRuntime).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps hosted management media available without ordinary authority, full privileges: %s", async (fullPrivileges) => {
    const root = join(directory, "managed");
    const f = fixture(join(root, "user"), { managementRoot: root, authority: "throws" });
    const context = { ...testManagementContext(), ...(fullPrivileges ? { privileged: { bash: true, network: true } } : {}) };
    await f.service.status(f.ref, context);
    expect(await f.service.media(f.ref, mediaId, context)).toMatchObject({ data: Buffer.from(block.data, "base64") });
    expect(f.authority).not.toHaveBeenCalled();
    await f.service.stop(f.ref, context);
    await expect(f.service.media(f.ref, mediaId, context)).rejects.toThrow("Session not found");
    expect(f.authority).not.toHaveBeenCalled();
  });
});

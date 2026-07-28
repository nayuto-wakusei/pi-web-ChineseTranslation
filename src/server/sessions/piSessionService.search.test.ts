import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { PiSessionService, type PiSessionListEntry, type PiSessionManager, type PiSessionManagerGateway } from "./piSessionService.js";
import type { ArchivedSessionRecord } from "./sessionArchiveStore.js";
import { createTestModelRuntime } from "./modelRuntime.testSupport.js";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { SessionPinStore } from "./sessionPinStore.js";

let tempDir: string;
let modelRuntime: ModelRuntime;
let services: PiSessionService[] = [];

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-session-search-test-"));
  modelRuntime = (await createTestModelRuntime()).modelRuntime;
  services = [];
});

afterEach(async () => {
  await Promise.all(services.map((service) => service.dispose()));
  await rm(tempDir, { recursive: true, force: true });
});

describe("PiSessionService session search and pins", () => {
  it("searches active full text, metadata, archived JSONL, and only the requested workspace", async () => {
    const cwd = join(tempDir, "workspace");
    const otherCwd = join(tempDir, "other");
    const archivedPath = join(tempDir, "archived-session.jsonl");
    await writeFile(archivedPath, `${JSON.stringify({ type: "message", content: "Archived transcript needle" })}\n`, "utf8");
    const active = sessionEntry("active-id", cwd, { name: "Named session", firstMessage: "First question", allMessagesText: "Full active transcript" });
    const other = sessionEntry("other-id", otherCwd, { allMessagesText: "Full active transcript" });
    const archived = {
      sessionId: "archived-id",
      cwd,
      archivedAt: "2026-06-10T00:00:00.000Z",
      originalPath: join(cwd, "archived-id.jsonl"),
      archivePath: archivedPath,
      created: "2026-06-09T00:00:00.000Z",
      modified: "2026-06-09T00:01:00.000Z",
      messageCount: 2,
      firstMessage: "Archived first message",
    };
    const service = createService([active, other], [archived]);

    await expect(service.search(cwd, "NAMED")).resolves.toEqual([expect.objectContaining({ id: "active-id" })]);
    await expect(service.search(cwd, "first question")).resolves.toEqual([expect.objectContaining({ id: "active-id" })]);
    await expect(service.search(cwd, "full active transcript")).resolves.toEqual([expect.objectContaining({ id: "active-id" })]);
    await expect(service.search(cwd, "archived transcript needle")).resolves.toEqual([expect.objectContaining({ id: "archived-id", archived: true })]);
    await expect(service.search(cwd, "other-id")).resolves.toEqual([]);
  });

  it("returns message-level user and assistant matches with transcript positions", async () => {
    const cwd = join(tempDir, "workspace");
    const active = sessionEntry("active-id", cwd, { allMessagesText: "Needle twice needle and answer needle" });
    const service = createService([active], [], undefined, new Map([
      [active.path, [
        { type: "message", message: { role: "user", content: "Needle twice needle" } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "answer needle" }] } },
        { type: "message", message: { role: "toolResult", content: "needle in tool output" } },
      ]],
    ]));

    const response = await service.searchContent(cwd, "needle");
    expect(response.matchCount).toBe(2);
    expect(response.truncated).toBe(false);
    expect(response.results[0]?.session.id).toBe("active-id");
    expect(response.results[0]?.matches.map(({ messageIndex, role, occurrenceCount }) => ({ messageIndex, role, occurrenceCount }))).toEqual([
      { messageIndex: 1, role: "assistant", occurrenceCount: 1 },
      { messageIndex: 0, role: "user", occurrenceCount: 2 },
    ]);
  });

  it("persists normal pins across service instances while isolating management users and workspaces", async () => {
    const cwd = join(tempDir, "workspace");
    const otherCwd = join(tempDir, "other");
    const entries = [sessionEntry("session-1", cwd), sessionEntry("other-session", otherCwd)];
    const pinFile = join(tempDir, "session-pins.json");
    const service = createService(entries, [], pinFile);
    await service.setPinned({ id: "session-1", cwd }, true);
    await expect(service.listPinned(cwd)).resolves.toEqual({ sessionIds: ["session-1"] });

    const restarted = createService(entries, [], pinFile);
    await expect(restarted.listPinned(cwd)).resolves.toEqual({ sessionIds: ["session-1"] });
    await expect(restarted.listPinned(otherCwd)).resolves.toEqual({ sessionIds: [] });

    const userA = managementContext("user-a");
    const userB = managementContext("user-b");
    await restarted.setPinned({ id: "session-1", cwd }, true, userA);
    await expect(restarted.listPinned(cwd, userA)).resolves.toEqual({ sessionIds: ["session-1"] });
    await expect(restarted.listPinned(cwd, userB)).resolves.toEqual({ sessionIds: [] });
  });
});

function createService(entries: PiSessionListEntry[], archivedRecords: readonly ArchivedSessionRecord[], pinFile = join(tempDir, "session-pins.json"), histories = new Map<string, unknown[]>()): PiSessionService {
  const archiveStore = {
    list: () => Promise.resolve([...archivedRecords]),
    get: () => Promise.resolve(undefined),
    archive: () => Promise.reject(new Error("not used")),
    restore: () => Promise.resolve(),
    isArchived: () => Promise.resolve(false),
  };
  const service = new PiSessionService(new SessionEventHub(), {
    agentDir: tempDir,
    sessionManager: new ListOnlySessionManager(entries, histories),
    archiveStore,
    pinStore: new SessionPinStore(pinFile),
    modelRuntime,
    heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  return service;
}

class ListOnlySessionManager implements PiSessionManagerGateway {
  constructor(private readonly entries: PiSessionListEntry[], private readonly histories = new Map<string, unknown[]>()) {}

  list(cwd: string): Promise<PiSessionListEntry[]> {
    return Promise.resolve(this.entries.filter((entry) => entry.cwd === cwd));
  }

  create(): PiSessionManager {
    throw new Error("not used");
  }

  open(path: string): PiSessionManager {
    const entry = this.entries.find((candidate) => candidate.path === path);
    const branch = this.histories.get(path);
    if (entry === undefined || branch === undefined) throw new Error("not used");
    return {
      getCwd: () => entry.cwd,
      getSessionId: () => entry.id,
      getSessionFile: () => entry.path,
      getBranch: () => branch,
      getLeafId: () => null,
    };
  }
}

function sessionEntry(id: string, cwd: string, overrides: Partial<PiSessionListEntry> = {}): PiSessionListEntry {
  return {
    id,
    path: join(cwd, `${id}.jsonl`),
    cwd,
    created: new Date("2026-06-09T00:00:00.000Z"),
    modified: new Date("2026-06-09T00:01:00.000Z"),
    messageCount: 1,
    firstMessage: id,
    allMessagesText: id,
    ...overrides,
  };
}

function managementContext(userId: string): ManagementEmbedContext {
  return { user: { id: userId, rootUserId: "root", roles: [], permissions: [] }, projects: [] };
}

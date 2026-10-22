import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { sessionArchiveDirectory } from "../../config.js";
import { defaultSessionArchiveFilePath, SessionArchiveStore } from "./sessionArchiveStore.js";
const tempRoots: string[] = [];
afterEach(async () => { await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

it("wires archive destinations from the captured daemon environment and config without relocating its index", async () => {
  // Importing sessiond starts a real daemon; pin its assembly while testing the store below.
  const source = await readFile(new URL("../sessiond.ts", import.meta.url), "utf8");
  expect(source).toMatch(/new SessionArchiveStore\(defaultSessionArchiveFilePath\(daemonEnvironment\), sessionArchiveDirectory\(daemonEnvironment, config\)\)/u);
});
  it("keeps old and new archives in the same index when the destination changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-archive-destination-"));
    tempRoots.push(root);
    const env = { PI_WEB_DATA_DIR: join(root, "state") };
    const indexPath = defaultSessionArchiveFilePath(env);
    const oldStore = new SessionArchiveStore(indexPath, sessionArchiveDirectory(env));
    const archiveInput = (sessionId: string) => ({
      sessionId, cwd: root, path: join(root, `${sessionId}.jsonl`),
      created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:01:00.000Z",
      messageCount: 1, firstMessage: "hello",
    });
    const oldInput = archiveInput("old");
    await writeFile(oldInput.path, "old transcript\n");
    const oldRecord = await oldStore.archive(oldInput);
    const newDirectory = join(root, "external-archives");
    const newStore = new SessionArchiveStore(indexPath, sessionArchiveDirectory({ ...env, PI_WEB_SESSION_ARCHIVE_DIR: newDirectory }));
    const newInput = archiveInput("new");
    await writeFile(newInput.path, "new transcript\n");
    const newRecord = await newStore.archive(newInput);

    expect(oldRecord.archivePath).toBe(join(env.PI_WEB_DATA_DIR, "archived-sessions", "old.jsonl"));
    expect(newRecord.archivePath).toBe(join(newDirectory, "new.jsonl"));
    await expect(newStore.list()).resolves.toEqual([oldRecord, newRecord]);
    await expect(readFile(indexPath, "utf8")).resolves.toContain('"sessionId": "old"');
    await expect(readFile(join(env.PI_WEB_DATA_DIR, "archived-sessions", "old.jsonl"), "utf8")).resolves.toBe("old transcript\n");
    await newStore.restore("old");
    await newStore.restore("new");
    await expect(readFile(oldInput.path, "utf8")).resolves.toBe("old transcript\n");
    await expect(readFile(newInput.path, "utf8")).resolves.toBe("new transcript\n");
    await expect(newStore.list()).resolves.toEqual([]);
  });

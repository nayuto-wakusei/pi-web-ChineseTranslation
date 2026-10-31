import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectivePiWebConfig, loadPiWebConfig, savePiWebConfig, sessionArchiveDirectory } from "./config.js";

let tempDir: string;
let configPath: string;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-session-overrides-"));
  configPath = join(tempDir, "config.json");
});
afterEach(async () => { await rm(tempDir, { recursive: true, force: true }); });

describe("sessionArchive config", () => {
  it("round-trips, preserves on unrelated saves, and removes the override", () => {
    const sessionArchive = { directory: "archive-files" };
    savePiWebConfig({ sessionArchive }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.sessionArchive).toEqual(sessionArchive);
    savePiWebConfig({ ...loadPiWebConfig(testOptions()).config, port: 9000 }, testOptions());
    expect(effectivePiWebConfig(testOptions()).config.sessionArchive).toEqual(sessionArchive);
    savePiWebConfig({}, testOptions());
    expect(loadPiWebConfig(testOptions()).config).not.toHaveProperty("sessionArchive");
  });

  it.each([null, [], "archive", { unknown: true }, { directory: "" }, { directory: "   " }, { directory: 1 }, { directory: null }, { directory: "a\u0000b" }])("rejects invalid archive config %j", async (sessionArchive) => {
    await writeFile(configPath, JSON.stringify({ sessionArchive }), "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config sessionArchive");
  });

  it("resolves the default, config, and environment destinations against the process cwd", () => {
    const env = { PI_WEB_DATA_DIR: "state" };
    const config = { sessionArchive: { directory: "configured" } };
    expect(sessionArchiveDirectory(env, {}, tempDir)).toBe(join(tempDir, "state", "archived-sessions"));
    expect(sessionArchiveDirectory(env, config, tempDir)).toBe(join(tempDir, "configured"));
    expect(sessionArchiveDirectory({ ...env, PI_WEB_SESSION_ARCHIVE_DIR: "external" }, config, tempDir)).toBe(join(tempDir, "external"));
    expect(sessionArchiveDirectory({ ...env, PI_WEB_SESSION_ARCHIVE_DIR: "" }, config, tempDir)).toBe(join(tempDir, "configured"));
    expect(sessionArchiveDirectory({}, { sessionArchive: { directory: tempDir } }, resolve(tempDir, "other"))).toBe(tempDir);
    expect(sessionArchiveDirectory(env, { sessionArchive: {} }, tempDir)).toBe(join(tempDir, "state", "archived-sessions"));
  });
});

it("does not resolve relative destinations against the config file or expand home shortcuts", () => {
  const sessionArchive = { directory: "~/archive-files" };
  savePiWebConfig({ sessionArchive }, testOptions());
  const loaded = loadPiWebConfig(testOptions());
  const daemonCwd = join(tempDir, "daemon-cwd");
  expect(loaded.config.sessionArchive).toEqual(sessionArchive);
  expect(sessionArchiveDirectory(testOptions().env, loaded.config, daemonCwd)).toBe(resolve(daemonCwd, "~/archive-files"));
  expect(sessionArchiveDirectory({ PI_WEB_SESSION_ARCHIVE_DIR: "~/external" }, loaded.config, daemonCwd)).toBe(resolve(daemonCwd, "~/external"));
});

function testOptions(): { env: NodeJS.ProcessEnv } {
  return { env: { PI_WEB_CONFIG: configPath } };
}

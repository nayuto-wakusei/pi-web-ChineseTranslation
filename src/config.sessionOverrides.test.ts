import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectivePiWebConfig, loadPiWebConfig, savePiWebConfig, sessionArchiveDirectory } from "./config.js";
import { KNOWN_THINKING_LEVELS } from "./shared/thinkingLevels.js";

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

describe("sessionNaming config", () => {
  it.each([{}, { model: "provider/model" }, { maxTokens: 24 }, { timeoutMs: 1 }, { timeoutMs: 10000 }, { timeoutMs: 2147483647 }, { model: "provider/org/model", maxTokens: Number.MAX_SAFE_INTEGER }, ...KNOWN_THINKING_LEVELS.map((thinkingLevel) => ({ thinkingLevel }))])("round-trips overrides %j without adding defaults", (sessionNaming) => {
    savePiWebConfig({ sessionNaming }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.sessionNaming).toEqual(sessionNaming);
    expect(effectivePiWebConfig(testOptions()).config.sessionNaming).toEqual(sessionNaming);
  });

  it("preserves overrides on unrelated saves and resets with an empty object", async () => {
    const sessionNaming = { model: "provider/model", maxTokens: 80, thinkingLevel: "off" as const, timeoutMs: 15000 };
    savePiWebConfig({ sessionNaming }, testOptions());
    savePiWebConfig({ ...loadPiWebConfig(testOptions()).config, port: 9000 }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.sessionNaming).toEqual(sessionNaming);
    savePiWebConfig({ ...loadPiWebConfig(testOptions()).config, sessionNaming: {} }, testOptions());
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({ port: 9000, sessionNaming: {} });
    savePiWebConfig({}, testOptions());
    expect(loadPiWebConfig(testOptions()).config).not.toHaveProperty("sessionNaming");
    expect(effectivePiWebConfig(testOptions()).config).not.toHaveProperty("sessionNaming");
  });

  it.each([
    null, [], "provider/model", { unknown: true },
    ...["", "model", "/model", "provider/", " provider/model", "provider/model ", "provider /model", 42, null].map((model) => ({ model })),
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "24", null].map((maxTokens) => ({ maxTokens })),
    ...["", "ultra", "MINIMAL", " minimal ", null, false, 42, {}, []].map((thinkingLevel) => ({ thinkingLevel })),
    ...[0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER, "10000", null, false, {}, []].map((timeoutMs) => ({ timeoutMs })),
  ])("rejects invalid overrides %j when loading", async (sessionNaming) => {
    await writeFile(configPath, JSON.stringify({ sessionNaming }), "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config sessionNaming");
  });

  it.each([NaN, Infinity, -Infinity, 0, 2147483648])("rejects invalid timeout %s before saving", (timeoutMs) => {
    expect(() => savePiWebConfig({ sessionNaming: { timeoutMs } }, testOptions())).toThrow("sessionNaming.timeoutMs");
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

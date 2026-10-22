import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { effectivePiWebConfig, loadPiWebConfig, savePiWebConfig } from "./config.js";

let tempDir: string;
let configPath: string;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-theme-config-"));
  configPath = join(tempDir, "config.json");
});
afterEach(async () => { await rm(tempDir, { recursive: true, force: true }); });
function testOptions() { return { env: { PI_WEB_CONFIG: configPath }, cwd: tempDir, home: tempDir }; }

it.each(["steer", "followUp"] as const)("round-trips and clears defaultStreamingBehavior %s", async (defaultStreamingBehavior) => {
    savePiWebConfig({ defaultStreamingBehavior }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.defaultStreamingBehavior).toBe(defaultStreamingBehavior);
    const current = loadPiWebConfig(testOptions()).config;
    savePiWebConfig({ ...current, port: 9000 }, testOptions());
    expect(effectivePiWebConfig(testOptions()).config.defaultStreamingBehavior).toBe(defaultStreamingBehavior);

    savePiWebConfig({ port: 9000 }, testOptions());
    expect(loadPiWebConfig(testOptions()).config).not.toHaveProperty("defaultStreamingBehavior");
    expect(JSON.parse(await readFile(configPath, "utf8"))).not.toHaveProperty("defaultStreamingBehavior");
  });

it.each(["", "followup", "queue", null, false, 42, {}, []])("rejects invalid defaultStreamingBehavior %j on load and save", async (value) => {
    await writeFile(configPath, JSON.stringify({ defaultStreamingBehavior: value }), "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config defaultStreamingBehavior");
    const original = await readFile(configPath, "utf8");
    // Model an untyped caller at the persistence boundary.
    const invalid = { defaultStreamingBehavior: value };
    // @ts-expect-error Deliberately exercise invalid untyped config input.
    expect(() => savePiWebConfig(invalid, testOptions())).toThrow("PI WEB config defaultStreamingBehavior");
    expect(await readFile(configPath, "utf8")).toBe(original);
  });

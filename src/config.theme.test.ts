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

it("preserves the theme default across unrelated saves and allows removing it", async () => {
    const defaultTheme = { themeId: "themes:pi-web-light", auto: false };
    savePiWebConfig({ defaultTheme, shortcuts: { "core:view.chat": "mod+1" } }, testOptions());
    const current = loadPiWebConfig(testOptions()).config;
    savePiWebConfig({ ...current, port: 9000 }, testOptions());
    expect(effectivePiWebConfig(testOptions()).config.defaultTheme).toEqual(defaultTheme);

    savePiWebConfig({ port: 9000 }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.defaultTheme).toBeUndefined();
    expect(JSON.parse(await readFile(configPath, "utf8"))).not.toHaveProperty("defaultTheme");
  });

it("rejects an invalid theme default rather than silently ignoring it", async () => {
    await writeFile(configPath, JSON.stringify({ defaultTheme: { themeId: "light", auto: true } }), "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config defaultTheme");
  });

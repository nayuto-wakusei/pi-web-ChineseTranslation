import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPiWebConfig, savePiWebConfig } from "./config.js";

let tempDir: string;
let configPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-config-test-"));
  configPath = join(tempDir, "config.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("PI WEB config persistence", () => {
  it("writes and reads the configured PI WEB config path", () => {
    const saved = savePiWebConfig({ host: "0.0.0.0", port: 9000, allowedHosts: ["example.local"], shortcuts: { "core:view.chat": "mod+1", "core:session.stop": null }, plugins: { "workspace-tasks": { enabled: false, settings: { configPath: ".pi-web/tasks.json" } } } }, testOptions());

    expect(saved).toEqual({ path: configPath, exists: true, config: { host: "0.0.0.0", port: 9000, allowedHosts: ["example.local"], shortcuts: { "core:view.chat": "mod+1", "core:session.stop": null }, plugins: { "workspace-tasks": { enabled: false, settings: { configPath: ".pi-web/tasks.json" } } } } });
    expect(loadPiWebConfig(testOptions())).toEqual(saved);
  });

  it("preserves unrelated config keys while replacing managed keys", async () => {
    await writeFile(configPath, `${JSON.stringify({ host: "old", port: 8504, allowedHosts: true, plugins: { info: { enabled: false } }, future: { enabled: true } }, null, 2)}\n`, "utf8");

    savePiWebConfig({ port: 9000, allowedHosts: [] }, testOptions());

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({ future: { enabled: true }, port: 9000, allowedHosts: [] });
  });

  it("rejects invalid plugin config", async () => {
    await writeFile(configPath, `${JSON.stringify({ plugins: { info: { enabled: "no" } } }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config plugin enabled values must be booleans");
  });

  it("reads and writes local management embed auth config", () => {
    const saved = savePiWebConfig({
      managementEmbed: {
        enabled: true,
        projectRoot: "/root/PiWeb",
        auth: {
          sharedSecretEnv: "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN",
          issuer: "telecom-portal",
          audience: "dify-external-portal",
        },
      },
    }, testOptions());

    expect(saved.config.managementEmbed?.auth).toEqual({
      sharedSecretEnv: "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN",
      issuer: "telecom-portal",
      audience: "dify-external-portal",
    });
    expect(loadPiWebConfig(testOptions()).config.managementEmbed?.auth).toEqual(saved.config.managementEmbed?.auth);
  });
});

function testOptions(): { env: NodeJS.ProcessEnv } {
  return { env: { PI_WEB_CONFIG: configPath } };
}

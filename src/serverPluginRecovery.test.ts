import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { disableServerPlugin } from "./serverPluginRecovery.js";
import { pluginRecoveryHelp } from "./pluginRecoveryCli.js";

describe("required Terminal offline recovery", () => {
  it("rejects disabling the required plugin without rewriting any config", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-web-recovery-"));
    const configPath = join(root, "config.json");
    const original = '{"plugins":{"pi-web.terminal":{"enabled":true}},"port":8504}\n';
    try {
      writeFileSync(configPath, original);
      expect(() => disableServerPlugin("pi-web.terminal", { configPath })).toThrow("不能禁用必需的 Terminal");
      expect(readFileSync(configPath, "utf8")).toBe(original);
      expect(pluginRecoveryHelp()).toContain("safe-start none");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still disables an optional plugin and preserves unrelated settings", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-web-recovery-"));
    const configPath = join(root, "config.json");
    try {
      writeFileSync(configPath, '{"port":8504,"plugins":{"optional":{"settings":{"value":42}}}}');
      disableServerPlugin("optional", { configPath });
      const updated: unknown = JSON.parse(readFileSync(configPath, "utf8"));
      expect(updated).toEqual({ port: 8504, plugins: { optional: { enabled: false, settings: { value: 42 } } } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

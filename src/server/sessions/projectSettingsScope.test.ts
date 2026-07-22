import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { projectAuthStoragePaths } from "./projectAuthService.js";
import {
  createScopedSettingsManager,
  ensureScopedSettingsBootstrapped,
  managementOrphanSettingsDirectory,
  projectPathKey,
  projectSettingsScopeDirectory,
  resolveSettingsScopeDirectory,
} from "./projectSettingsScope.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("projectSettingsScope", () => {
  it("scopes normal settings next to project auth and management under a parallel tree", async () => {
    const root = await tempRoot();
    const dataDir = join(root, "data");
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");

    const normalA = projectSettingsScopeDirectory(dataDir, projectA, "normal");
    const normalB = projectSettingsScopeDirectory(dataDir, projectB, "normal");
    const managementA = projectSettingsScopeDirectory(dataDir, projectA, "management");
    const managementB = projectSettingsScopeDirectory(dataDir, projectB, "management");

    expect(normalA).toBe(projectAuthStoragePaths(dataDir, projectA).directory);
    expect(normalA).not.toBe(normalB);
    expect(managementA).not.toBe(managementB);
    expect(managementA).not.toBe(normalA);
    expect(managementA).toBe(join(dataDir, "management-embed", "projects", projectPathKey(projectA)));
    expect(managementOrphanSettingsDirectory(dataDir, projectA)).toBe(
      join(dataDir, "management-embed", "orphan", projectPathKey(projectA)),
    );

    expect(resolveSettingsScopeDirectory({ dataDir, cwd: projectA, mode: "normal", projectPath: projectA })).toBe(normalA);
    expect(resolveSettingsScopeDirectory({ dataDir, cwd: projectA, mode: "management", projectPath: projectA })).toBe(managementA);
    expect(resolveSettingsScopeDirectory({ dataDir, cwd: projectA, mode: "management" })).toBe(
      managementOrphanSettingsDirectory(dataDir, projectA),
    );
    expect(resolveSettingsScopeDirectory({ dataDir, cwd: projectA, mode: "normal" })).toBe(
      join(dataDir, "projects", "_unscoped", projectPathKey(projectA)),
    );
  });

  it("bootstraps scoped settings once from the global agent dir and never overwrites", async () => {
    const root = await tempRoot();
    const globalAgentDir = join(root, "global-agent");
    const scopeDir = join(root, "scope");
    await mkdir(globalAgentDir, { recursive: true });
    await writeFile(join(globalAgentDir, "settings.json"), `${JSON.stringify({ defaultThinkingLevel: "high", packages: ["./pkg"] }, null, 2)}\n`);

    const firstPath = await ensureScopedSettingsBootstrapped(scopeDir, globalAgentDir);
    expect(firstPath).toBe(join(scopeDir, "settings.json"));
    expect(JSON.parse(await readFile(firstPath, "utf8"))).toEqual({
      defaultThinkingLevel: "high",
      packages: ["./pkg"],
    });

    await writeFile(join(globalAgentDir, "settings.json"), `${JSON.stringify({ defaultThinkingLevel: "low" }, null, 2)}\n`);
    await ensureScopedSettingsBootstrapped(scopeDir, globalAgentDir);
    expect(JSON.parse(await readFile(firstPath, "utf8"))).toEqual({
      defaultThinkingLevel: "high",
      packages: ["./pkg"],
    });
  });

  it("creates empty scoped settings when the global file is missing", async () => {
    const root = await tempRoot();
    const scopeDir = join(root, "scope");
    const path = await ensureScopedSettingsBootstrapped(scopeDir, join(root, "missing-global"));
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({});
  });

  it("isolates defaultThinkingLevel across modes and projects via scoped SettingsManagers", async () => {
    const root = await tempRoot();
    const dataDir = join(root, "data");
    const globalAgentDir = join(root, "global-agent");
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    await mkdir(globalAgentDir, { recursive: true });
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
    await writeFile(join(globalAgentDir, "settings.json"), `${JSON.stringify({ defaultThinkingLevel: "off" }, null, 2)}\n`);

    const normalA = await createScopedSettingsManager({
      cwd: projectA,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectA, "normal"),
      globalAgentDir,
    });
    const managementA = await createScopedSettingsManager({
      cwd: projectA,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectA, "management"),
      globalAgentDir,
    });
    const normalB = await createScopedSettingsManager({
      cwd: projectB,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectB, "normal"),
      globalAgentDir,
    });

    normalA.setDefaultThinkingLevel("high");
    managementA.setDefaultThinkingLevel("medium");
    normalB.setDefaultThinkingLevel("low");
    await Promise.all([normalA.flush(), managementA.flush(), normalB.flush()]);

    // Reconstruct from disk (same path production reloads).
    const normalAReload = SettingsManager.create(projectA, projectSettingsScopeDirectory(dataDir, projectA, "normal"));
    const managementAReload = SettingsManager.create(projectA, projectSettingsScopeDirectory(dataDir, projectA, "management"));
    const normalBReload = SettingsManager.create(projectB, projectSettingsScopeDirectory(dataDir, projectB, "normal"));
    const globalReload = SettingsManager.create(projectA, globalAgentDir);

    expect(normalAReload.getDefaultThinkingLevel()).toBe("high");
    expect(managementAReload.getDefaultThinkingLevel()).toBe("medium");
    expect(normalBReload.getDefaultThinkingLevel()).toBe("low");
    // Global agent settings must not be written by scoped preference changes.
    expect(globalReload.getDefaultThinkingLevel()).toBe("off");
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-settings-scope-"));
  tempRoots.push(root);
  return root;
}

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { projectAuthStoragePaths } from "./projectAuthService.js";
import {
  createScopedSettingsManager,
  legacyScopedSettingsFilePath,
  managementOrphanSettingsDirectory,
  preferencesFilePath,
  projectPathKey,
  projectSettingsScopeDirectory,
  resolveSettingsScopeDirectory,
} from "./projectSettingsScope.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("projectSettingsScope", () => {
  it("scopes normal preferences next to project auth and management under a parallel tree", async () => {
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

  it("isolates thinking and default model overrides without freezing shared agent settings", async () => {
    const root = await tempRoot();
    const dataDir = join(root, "data");
    const globalAgentDir = join(root, "global-agent");
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    await mkdir(globalAgentDir, { recursive: true });
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
    await writeFile(
      join(globalAgentDir, "settings.json"),
      `${JSON.stringify({
        defaultThinkingLevel: "off",
        defaultProvider: "anthropic",
        defaultModel: "claude-old",
        packages: ["./pkg-a"],
        enabledModels: ["anthropic/*"],
      }, null, 2)}\n`,
    );

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

    // Shared configuration remains visible through the scoped manager.
    expect(normalA.getPackages()).toEqual(["./pkg-a"]);
    expect(normalA.getEnabledModels()).toEqual(["anthropic/*"]);

    normalA.setDefaultThinkingLevel("high");
    normalA.setDefaultModelAndProvider("openai", "gpt-test");
    managementA.setDefaultThinkingLevel("medium");
    managementA.setDefaultModelAndProvider("google", "gemini-test");
    normalB.setDefaultThinkingLevel("low");
    await Promise.all([normalA.flush(), managementA.flush(), normalB.flush()]);

    // Later global package installs must remain visible to already-bootstrapped scopes.
    await writeFile(
      join(globalAgentDir, "settings.json"),
      `${JSON.stringify({
        defaultThinkingLevel: "off",
        defaultProvider: "anthropic",
        defaultModel: "claude-old",
        packages: ["./pkg-a", "./pkg-b"],
        enabledModels: ["anthropic/*", "openai/*"],
        extensions: ["./ext-new"],
      }, null, 2)}\n`,
    );

    const normalAReload = await createScopedSettingsManager({
      cwd: projectA,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectA, "normal"),
      globalAgentDir,
    });
    const managementAReload = await createScopedSettingsManager({
      cwd: projectA,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectA, "management"),
      globalAgentDir,
    });
    const normalBReload = await createScopedSettingsManager({
      cwd: projectB,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectB, "normal"),
      globalAgentDir,
    });
    const globalReload = SettingsManager.create(projectA, globalAgentDir);

    expect(normalAReload.getDefaultThinkingLevel()).toBe("high");
    expect(normalAReload.getDefaultProvider()).toBe("openai");
    expect(normalAReload.getDefaultModel()).toBe("gpt-test");
    expect(managementAReload.getDefaultThinkingLevel()).toBe("medium");
    expect(managementAReload.getDefaultProvider()).toBe("google");
    expect(managementAReload.getDefaultModel()).toBe("gemini-test");
    expect(normalBReload.getDefaultThinkingLevel()).toBe("low");

    expect(normalAReload.getPackages()).toEqual(["./pkg-a", "./pkg-b"]);
    expect(normalAReload.getEnabledModels()).toEqual(["anthropic/*", "openai/*"]);
    expect(normalAReload.getExtensionPaths()).toEqual(["./ext-new"]);

    // Preference overrides stay out of the shared agent settings file.
    expect(globalReload.getDefaultThinkingLevel()).toBe("off");
    expect(globalReload.getDefaultProvider()).toBe("anthropic");
    expect(globalReload.getDefaultModel()).toBe("claude-old");
    expect(globalReload.getPackages()).toEqual(["./pkg-a", "./pkg-b"]);

    expect(JSON.parse(await readFile(preferencesFilePath(projectSettingsScopeDirectory(dataDir, projectA, "normal")), "utf8"))).toEqual({
      defaultThinkingLevel: "high",
      defaultProvider: "openai",
      defaultModel: "gpt-test",
    });
  });

  it("writes non-preference session settings back to the real agent dir", async () => {
    const root = await tempRoot();
    const globalAgentDir = join(root, "global-agent");
    const projectPath = join(root, "project");
    const scopeDirectory = join(root, "scope");
    await mkdir(globalAgentDir, { recursive: true });
    await mkdir(projectPath, { recursive: true });
    await writeFile(
      join(globalAgentDir, "settings.json"),
      `${JSON.stringify({ defaultThinkingLevel: "off", packages: ["./pkg"] }, null, 2)}\n`,
    );

    const settings = await createScopedSettingsManager({ cwd: projectPath, scopeDirectory, globalAgentDir });
    settings.setDefaultThinkingLevel("high");
    settings.setCompactionEnabled(false);
    settings.setRetryEnabled(false);
    await settings.flush();

    expect(JSON.parse(await readFile(preferencesFilePath(scopeDirectory), "utf8"))).toEqual({
      defaultThinkingLevel: "high",
    });
    expect(JSON.parse(await readFile(join(globalAgentDir, "settings.json"), "utf8"))).toMatchObject({
      defaultThinkingLevel: "off",
      packages: ["./pkg"],
      compaction: { enabled: false },
      retry: { enabled: false },
    });
  });

  it("migrates only preference keys from a legacy whole-file scoped settings snapshot", async () => {
    const root = await tempRoot();
    const globalAgentDir = join(root, "global-agent");
    const projectPath = join(root, "project");
    const scopeDirectory = join(root, "scope");
    await mkdir(globalAgentDir, { recursive: true });
    await mkdir(projectPath, { recursive: true });
    await mkdir(scopeDirectory, { recursive: true });
    await writeFile(
      join(globalAgentDir, "settings.json"),
      `${JSON.stringify({
        defaultThinkingLevel: "off",
        packages: ["./fresh-pkg"],
        enabledModels: ["fresh/*"],
      }, null, 2)}\n`,
    );
    await writeFile(
      legacyScopedSettingsFilePath(scopeDirectory),
      `${JSON.stringify({
        defaultThinkingLevel: "high",
        defaultProvider: "openai",
        defaultModel: "gpt-legacy",
        packages: ["./stale-pkg"],
        enabledModels: ["stale/*"],
      }, null, 2)}\n`,
    );

    const settings = await createScopedSettingsManager({ cwd: projectPath, scopeDirectory, globalAgentDir });
    expect(settings.getDefaultThinkingLevel()).toBe("high");
    expect(settings.getDefaultProvider()).toBe("openai");
    expect(settings.getDefaultModel()).toBe("gpt-legacy");
    expect(settings.getPackages()).toEqual(["./fresh-pkg"]);
    expect(settings.getEnabledModels()).toEqual(["fresh/*"]);
    expect(JSON.parse(await readFile(preferencesFilePath(scopeDirectory), "utf8"))).toEqual({
      defaultThinkingLevel: "high",
      defaultProvider: "openai",
      defaultModel: "gpt-legacy",
    });
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-settings-scope-"));
  tempRoots.push(root);
  return root;
}

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

  it("isolates model preferences without freezing shared non-model agent settings", async () => {
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
      mode: "normal",
    });
    const managementA = await createScopedSettingsManager({
      cwd: projectA,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectA, "management"),
      globalAgentDir,
      mode: "management",
    });
    const normalB = await createScopedSettingsManager({
      cwd: projectB,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectB, "normal"),
      globalAgentDir,
      mode: "normal",
    });

    // Shared resources remain visible, while global model scope is not injected into either mode.
    expect(normalA.getPackages()).toEqual(["./pkg-a"]);
    expect(normalA.getEnabledModels()).toBeUndefined();
    expect(managementA.getPackages()).toEqual(["./pkg-a"]);
    expect(managementA.getEnabledModels()).toBeUndefined();

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
      mode: "normal",
    });
    const managementAReload = await createScopedSettingsManager({
      cwd: projectA,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectA, "management"),
      globalAgentDir,
      mode: "management",
    });
    const normalBReload = await createScopedSettingsManager({
      cwd: projectB,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectB, "normal"),
      globalAgentDir,
      mode: "normal",
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
    expect(normalAReload.getEnabledModels()).toBeUndefined();
    expect(normalAReload.getExtensionPaths()).toEqual(["./ext-new"]);
    expect(managementAReload.getPackages()).toEqual(["./pkg-a", "./pkg-b"]);
    expect(managementAReload.getEnabledModels()).toBeUndefined();
    expect(managementAReload.getExtensionPaths()).toEqual(["./ext-new"]);

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

  it("keeps enabled model edits isolated between normal projects", async () => {
    const root = await tempRoot();
    const dataDir = join(root, "data");
    const globalAgentDir = join(root, "global-agent");
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    await Promise.all([mkdir(globalAgentDir, { recursive: true }), mkdir(projectA, { recursive: true }), mkdir(projectB, { recursive: true })]);
    await writeFile(join(globalAgentDir, "settings.json"), `${JSON.stringify({
      packages: ["./shared-package"],
      enabledModels: ["leaked/project-a-model"],
    }, null, 2)}\n`);
    const scopeA = projectSettingsScopeDirectory(dataDir, projectA, "normal");
    const scopeB = projectSettingsScopeDirectory(dataDir, projectB, "normal");
    const settingsA = await createScopedSettingsManager({ cwd: projectA, scopeDirectory: scopeA, globalAgentDir, mode: "normal" });
    const settingsB = await createScopedSettingsManager({ cwd: projectB, scopeDirectory: scopeB, globalAgentDir, mode: "normal" });

    expect(settingsA.getEnabledModels()).toBeUndefined();
    expect(settingsB.getEnabledModels()).toBeUndefined();
    settingsA.setEnabledModels(["provider-a/model-a"]);
    await settingsA.flush();

    const settingsAReload = await createScopedSettingsManager({ cwd: projectA, scopeDirectory: scopeA, globalAgentDir, mode: "normal" });
    const settingsBReload = await createScopedSettingsManager({ cwd: projectB, scopeDirectory: scopeB, globalAgentDir, mode: "normal" });
    expect(settingsAReload.getEnabledModels()).toEqual(["provider-a/model-a"]);
    expect(settingsBReload.getEnabledModels()).toBeUndefined();
    expect(JSON.parse(await readFile(preferencesFilePath(scopeA), "utf8"))).toEqual({ enabledModels: ["provider-a/model-a"] });
    expect(JSON.parse(await readFile(join(globalAgentDir, "settings.json"), "utf8"))).toEqual({
      packages: ["./shared-package"],
      enabledModels: ["leaked/project-a-model"],
    });
  });

  it("hides ordinary enabled models from management without changing stored settings", async () => {
    const root = await tempRoot();
    const globalAgentDir = join(root, "global-agent");
    const projectPath = join(root, "project");
    const projectSettingsDir = join(projectPath, ".pi");
    const scopeDirectory = join(root, "management-scope");
    const globalSettingsPath = join(globalAgentDir, "settings.json");
    const projectSettingsPath = join(projectSettingsDir, "settings.json");
    await mkdir(globalAgentDir, { recursive: true });
    await mkdir(projectSettingsDir, { recursive: true });
    await writeFile(globalSettingsPath, `${JSON.stringify({
      packages: ["./global-package"],
      enabledModels: ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro", "scnet/GLM-5.2"],
    }, null, 2)}\n`);
    await writeFile(projectSettingsPath, `${JSON.stringify({
      packages: ["./project-package"],
      enabledModels: ["project/private-model"],
    }, null, 2)}\n`);

    const settings = await createScopedSettingsManager({
      cwd: projectPath,
      scopeDirectory,
      globalAgentDir,
      mode: "management",
    });

    expect(settings.getPackages()).toEqual(["./project-package"]);
    expect(settings.getEnabledModels()).toBeUndefined();

    settings.setRetryEnabled(false);
    settings.setProjectPackages([{ source: "./updated-project-package" }]);
    await settings.flush();

    expect(JSON.parse(await readFile(globalSettingsPath, "utf8"))).toMatchObject({
      enabledModels: ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro", "scnet/GLM-5.2"],
      retry: { enabled: false },
    });
    expect(JSON.parse(await readFile(projectSettingsPath, "utf8"))).toMatchObject({
      enabledModels: ["project/private-model"],
      packages: [{ source: "./updated-project-package" }],
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
      `${JSON.stringify({
        defaultThinkingLevel: "off",
        packages: ["./pkg"],
        enabledModels: ["anthropic/*"],
      }, null, 2)}\n`,
    );

    const settings = await createScopedSettingsManager({ cwd: projectPath, scopeDirectory, globalAgentDir, mode: "normal" });
    settings.setDefaultThinkingLevel("high");
    settings.setCompactionEnabled(false);
    settings.setRetryEnabled(false);
    settings.setEnabledModels(undefined);
    await settings.flush();

    expect(JSON.parse(await readFile(preferencesFilePath(scopeDirectory), "utf8"))).toEqual({
      defaultThinkingLevel: "high",
    });
    const globalSettings: unknown = JSON.parse(await readFile(join(globalAgentDir, "settings.json"), "utf8"));
    expect(globalSettings).toMatchObject({
      defaultThinkingLevel: "off",
      packages: ["./pkg"],
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    expect(globalSettings).toHaveProperty("enabledModels", ["anthropic/*"]);
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

    const settings = await createScopedSettingsManager({ cwd: projectPath, scopeDirectory, globalAgentDir, mode: "normal" });
    expect(settings.getDefaultThinkingLevel()).toBe("high");
    expect(settings.getDefaultProvider()).toBe("openai");
    expect(settings.getDefaultModel()).toBe("gpt-legacy");
    expect(settings.getPackages()).toEqual(["./fresh-pkg"]);
    expect(settings.getEnabledModels()).toEqual(["stale/*"]);
    expect(JSON.parse(await readFile(preferencesFilePath(scopeDirectory), "utf8"))).toEqual({
      defaultThinkingLevel: "high",
      defaultProvider: "openai",
      defaultModel: "gpt-legacy",
      enabledModels: ["stale/*"],
    });
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-settings-scope-"));
  tempRoots.push(root);
  return root;
}

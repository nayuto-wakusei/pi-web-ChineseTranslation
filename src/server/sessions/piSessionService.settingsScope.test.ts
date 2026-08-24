import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  createScopedSettingsManager,
  preferencesFilePath,
  projectSettingsScopeDirectory,
} from "./projectSettingsScope.js";
import { resolveSessionModelOptions } from "./sessionModelScope.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * Behavioral coverage for the runtime wiring contract: agentDir stays shared
 * for resources, model settings are mode x project scoped, and shared settings
 * such as packages keep tracking the real agentDir settings.json.
 */
describe("PiSessionService settings scope wiring", () => {
  it("keeps preference overrides isolated while packages follow the real agent dir", async () => {
    const root = await tempRoot();
    const dataDir = join(root, "data");
    const globalAgentDir = join(root, "global-agent");
    const projectPath = join(root, "project");
    await mkdir(projectPath, { recursive: true });
    await mkdir(globalAgentDir, { recursive: true });
    await writeFile(join(globalAgentDir, "auth.json"), "{}\n");
    await writeFile(join(globalAgentDir, "models.json"), `${JSON.stringify({ providers: {} })}\n`);
    await writeFile(
      join(globalAgentDir, "settings.json"),
      `${JSON.stringify({ defaultThinkingLevel: "off", packages: ["./pkg-a"] }, null, 2)}\n`,
    );

    const modelRuntime = await ModelRuntime.create({
      authPath: join(globalAgentDir, "auth.json"),
      modelsPath: join(globalAgentDir, "models.json"),
      allowModelNetwork: false,
    });

    const normalSettings = await createScopedSettingsManager({
      cwd: projectPath,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectPath, "normal"),
      globalAgentDir,
      mode: "normal",
    });
    const managementSettings = await createScopedSettingsManager({
      cwd: projectPath,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectPath, "management"),
      globalAgentDir,
      mode: "management",
    });

    const normalServices = await createAgentSessionServices({
      cwd: projectPath,
      agentDir: globalAgentDir,
      modelRuntime,
      settingsManager: normalSettings,
    });
    const managementServices = await createAgentSessionServices({
      cwd: projectPath,
      agentDir: globalAgentDir,
      modelRuntime,
      settingsManager: managementSettings,
    });

    expect(normalServices.agentDir).toBe(managementServices.agentDir);
    expect(normalServices.settingsManager).not.toBe(managementServices.settingsManager);
    expect(normalServices.settingsManager.getPackages()).toEqual(["./pkg-a"]);

    normalServices.settingsManager.setDefaultThinkingLevel("high");
    normalServices.settingsManager.setDefaultModelAndProvider("openai", "gpt-normal");
    managementServices.settingsManager.setDefaultThinkingLevel("medium");
    managementServices.settingsManager.setDefaultModelAndProvider("google", "gemini-management");
    await Promise.all([normalServices.settingsManager.flush(), managementServices.settingsManager.flush()]);

    await writeFile(
      join(globalAgentDir, "settings.json"),
      `${JSON.stringify({
        defaultThinkingLevel: "off",
        packages: ["./pkg-a", "./pkg-b"],
        enabledModels: ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro", "scnet/GLM-5.2"],
      }, null, 2)}\n`,
    );

    const normalPath = preferencesFilePath(projectSettingsScopeDirectory(dataDir, projectPath, "normal"));
    const managementPath = preferencesFilePath(projectSettingsScopeDirectory(dataDir, projectPath, "management"));
    const globalPath = join(globalAgentDir, "settings.json");

    expect(JSON.parse(await readFile(normalPath, "utf8"))).toEqual({
      defaultThinkingLevel: "high",
      defaultProvider: "openai",
      defaultModel: "gpt-normal",
    });
    expect(JSON.parse(await readFile(managementPath, "utf8"))).toEqual({
      defaultThinkingLevel: "medium",
      defaultProvider: "google",
      defaultModel: "gemini-management",
    });
    expect(settingsField(await readFile(globalPath, "utf8"), "defaultThinkingLevel")).toBe("off");
    expect(settingsField(await readFile(globalPath, "utf8"), "packages")).toEqual(["./pkg-a", "./pkg-b"]);

    const sessionsRoot = join(root, "sessions");
    await mkdir(sessionsRoot, { recursive: true });
    const { session } = await createAgentSessionFromServices({
      services: normalServices,
      sessionManager: SessionManager.create(projectPath, sessionsRoot),
    });
    expect(session.settingsManager.getDefaultThinkingLevel()).toBe("high");
    expect(session.settingsManager.getDefaultModel()).toBe("gpt-normal");

    // Reload after the global package install to prove the freeze regression is gone.
    const normalReload = await createScopedSettingsManager({
      cwd: projectPath,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectPath, "normal"),
      globalAgentDir,
      mode: "normal",
    });
    const managementReload = await createScopedSettingsManager({
      cwd: projectPath,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectPath, "management"),
      globalAgentDir,
      mode: "management",
    });
    expect(managementReload.getDefaultThinkingLevel()).toBe("medium");
    expect(managementReload.getPackages()).toEqual(["./pkg-a", "./pkg-b"]);
    expect(normalReload.getEnabledModels()).toBeUndefined();
    expect(managementReload.getEnabledModels()).toBeUndefined();

    const normalResolution = await resolveSessionModelOptions({
      services: { settingsManager: normalReload, modelRuntime },
      hasExistingSession: false,
    });
    const managementResolution = await resolveSessionModelOptions({
      services: { settingsManager: managementReload, modelRuntime },
      hasExistingSession: false,
    });
    expect(normalResolution.diagnostics).toEqual([]);
    expect(managementResolution.diagnostics).toEqual([]);
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-session-settings-scope-"));
  tempRoots.push(root);
  return root;
}

function settingsField(raw: string, field: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  if (!isJsonObject(parsed)) throw new Error("Expected settings object");
  return parsed[field];
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

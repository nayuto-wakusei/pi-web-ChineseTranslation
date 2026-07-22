import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  createScopedSettingsManager,
  projectSettingsScopeDirectory,
} from "./projectSettingsScope.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * Behavioral coverage for the runtime wiring contract: agentDir stays shared
 * for resources, but SettingsManager global settings (defaultThinkingLevel)
 * are mode×project scoped and never written back to the global agent dir.
 *
 * Full PiSessionService.createRuntime is covered indirectly via the same
 * createAgentSessionServices({ settingsManager }) path the factories use.
 */
describe("PiSessionService settings scope wiring", () => {
  it("keeps defaultThinkingLevel isolated when services use scoped SettingsManagers", async () => {
    const root = await tempRoot();
    const dataDir = join(root, "data");
    const globalAgentDir = join(root, "global-agent");
    const projectPath = join(root, "project");
    await mkdir(projectPath, { recursive: true });
    await mkdir(globalAgentDir, { recursive: true });
    await writeFile(join(globalAgentDir, "auth.json"), "{}\n");
    await writeFile(join(globalAgentDir, "models.json"), `${JSON.stringify({ providers: {} })}\n`);
    await writeFile(join(globalAgentDir, "settings.json"), `${JSON.stringify({ defaultThinkingLevel: "off" }, null, 2)}\n`);

    const modelRuntime = await ModelRuntime.create({
      authPath: join(globalAgentDir, "auth.json"),
      modelsPath: join(globalAgentDir, "models.json"),
      allowModelNetwork: false,
    });

    const normalSettings = await createScopedSettingsManager({
      cwd: projectPath,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectPath, "normal"),
      globalAgentDir,
    });
    const managementSettings = await createScopedSettingsManager({
      cwd: projectPath,
      scopeDirectory: projectSettingsScopeDirectory(dataDir, projectPath, "management"),
      globalAgentDir,
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

    // Prefer writing through the session path when a reasoning model is present;
    // without one, available thinking levels collapse to off — exercise the same
    // SettingsManager call setThinkingLevel uses when levels can change.
    normalServices.settingsManager.setDefaultThinkingLevel("high");
    managementServices.settingsManager.setDefaultThinkingLevel("medium");
    await Promise.all([normalServices.settingsManager.flush(), managementServices.settingsManager.flush()]);

    const normalPath = join(projectSettingsScopeDirectory(dataDir, projectPath, "normal"), "settings.json");
    const managementPath = join(projectSettingsScopeDirectory(dataDir, projectPath, "management"), "settings.json");
    const globalPath = join(globalAgentDir, "settings.json");

    expect(settingsField(await readFile(normalPath, "utf8"), "defaultThinkingLevel")).toBe("high");
    expect(settingsField(await readFile(managementPath, "utf8"), "defaultThinkingLevel")).toBe("medium");
    expect(settingsField(await readFile(globalPath, "utf8"), "defaultThinkingLevel")).toBe("off");

    // Session construction still accepts the scoped manager (smoke: no throw).
    const sessionsRoot = join(root, "sessions");
    await mkdir(sessionsRoot, { recursive: true });
    const { session } = await createAgentSessionFromServices({
      services: normalServices,
      sessionManager: SessionManager.create(projectPath, sessionsRoot),
    });
    expect(session.settingsManager.getDefaultThinkingLevel()).toBe("high");
    // Reloading management scope from disk still sees the other mode's value.
    expect(SettingsManager.create(projectPath, projectSettingsScopeDirectory(dataDir, projectPath, "management")).getDefaultThinkingLevel()).toBe("medium");
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

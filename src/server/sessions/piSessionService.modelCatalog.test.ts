import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, sessionGateway } from "./piSessionService.testSupport.js";
import { preferencesFilePath, resolveSettingsScopeDirectory } from "./projectSettingsScope.js";

const PROVIDER = "anthropic";
const FIRST_MODEL = "claude-opus-4-6";
const DEFAULT_MODEL = "claude-sonnet-4-5";

let modelRuntime: ModelRuntime;
const tempDirs: string[] = [];

beforeAll(async () => {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(PROVIDER, () => Promise.resolve({ type: "api_key", key: "sk-test" }));
  modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function startSessionWithSettings(settings?: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-model-catalog-"));
  tempDirs.push(root);
  const agentDir = join(root, "agent");
  const dataDir = join(root, "data");
  const workspace = join(root, "workspace");
  await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(dataDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
  const settingsScope = resolveSettingsScopeDirectory({ dataDir, cwd: workspace, mode: "normal" });
  const settingsPath = preferencesFilePath(settingsScope);
  if (settings !== undefined) {
    await mkdir(settingsScope, { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings));
  }
  const gateway = sessionGateway([]);
  gateway.create = (cwd) => SessionManager.inMemory(cwd);
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir,
    dataDir,
    modelRuntime,
    sessionManager: gateway,
    heartbeatIntervalMs: 60_000,
  });
  try {
    const created = await service.start(workspace);
    return { service, ref: { id: created.id, cwd: workspace }, settingsPath };
  } catch (error) {
    await service.dispose();
    throw error;
  }
}

const catalogIds = (catalog: readonly { provider: string; id: string }[]): string[] => catalog.map((entry) => `${entry.provider}/${entry.id}`);

async function persistedEnabledModels(settingsPath: string): Promise<{ found: boolean; value?: unknown }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(settingsPath, "utf8"));
    if (!isJsonObject(parsed) || !Object.hasOwn(parsed, "enabledModels")) return { found: false };
    return { found: true, value: parsed["enabledModels"] };
  } catch {
    return { found: false };
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function expectPersistedEnabledModels(settingsPath: string, expected: string[] | undefined): Promise<void> {
  await vi.waitFor(async () => {
    const persisted = await persistedEnabledModels(settingsPath);
    expect(persisted).toEqual(expected === undefined ? { found: false } : { found: true, value: expected });
  }, { timeout: 5_000 });
}

function managementContext(): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-1", roles: [], permissions: [] },
    projects: [{ id: "project-1", name: "Project 1" }],
  };
}

describe("PiSessionService model catalog", () => {
  it("marks every available model enabled in catalog order when no scope is configured", async () => {
    const { service, ref } = await startSessionWithSettings();
    try {
      const catalog = await service.modelCatalog(ref);
      const snapshotIds = catalogIds(modelRuntime.getAvailableSnapshot());

      expect(catalog.length).toBeGreaterThan(1);
      expect(catalogIds(catalog)).toEqual(snapshotIds);
      expect(catalog.every((entry) => entry.enabled)).toBe(true);
    } finally {
      await service.dispose();
    }
  });

  it("lists enabled models first in configured order", async () => {
    const { service, ref } = await startSessionWithSettings({
      enabledModels: [`${PROVIDER}/${FIRST_MODEL}`, `${PROVIDER}/${DEFAULT_MODEL}`],
    });
    try {
      const catalog = await service.modelCatalog(ref);

      expect(catalogIds(catalog.slice(0, 2))).toEqual([`${PROVIDER}/${FIRST_MODEL}`, `${PROVIDER}/${DEFAULT_MODEL}`]);
      expect(catalog.slice(0, 2).every((entry) => entry.enabled)).toBe(true);
      expect(catalog.slice(2).every((entry) => !entry.enabled)).toBe(true);
    } finally {
      await service.dispose();
    }
  });

  it("persists a disable edit, narrows cycling, and still permits explicit model selection", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings();
    try {
      const catalog = await service.modelCatalog(ref);
      const target = catalog[0];
      if (target === undefined) throw new Error("expected a catalog entry");
      const targetId = `${target.provider}/${target.id}`;
      const remainingIds = catalogIds(catalog).filter((id) => id !== targetId);

      const updated = await service.setModelEnabled(ref, target.provider, target.id, false);

      expect(updated.find((entry) => `${entry.provider}/${entry.id}` === targetId)?.enabled).toBe(false);
      expect(catalogIds((await service.availableModels(ref)).map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })))).toEqual(remainingIds);
      await expectPersistedEnabledModels(settingsPath, remainingIds);

      const selected = await service.setModel(ref, target.provider, target.id);
      expect(selected.model).toMatchObject({ provider: target.provider, id: target.id });
    } finally {
      await service.dispose();
    }
  });

  it("normalizes re-enabling every model back to no stored scope", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings();
    try {
      const catalog = await service.modelCatalog(ref);
      const target = catalog[0];
      if (target === undefined) throw new Error("expected a catalog entry");

      await service.setModelEnabled(ref, target.provider, target.id, false);
      const restored = await service.setModelEnabled(ref, target.provider, target.id, true);

      expect(restored.every((entry) => entry.enabled)).toBe(true);
      expect(catalogIds(restored)).toEqual(catalogIds(catalog));
      await expectPersistedEnabledModels(settingsPath, undefined);
    } finally {
      await service.dispose();
    }
  });

  it("rejects enabled-model mutations from management embed", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings({ enabledModels: [`${PROVIDER}/${FIRST_MODEL}`] });
    try {
      await expect(service.setModelEnabled(ref, PROVIDER, DEFAULT_MODEL, true, managementContext()))
        .rejects.toThrow("管理嵌入模式不允许修改已启用模型范围");
      await expectPersistedEnabledModels(settingsPath, [`${PROVIDER}/${FIRST_MODEL}`]);
    } finally {
      await service.dispose();
    }
  });
});

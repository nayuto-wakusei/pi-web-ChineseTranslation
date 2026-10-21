import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, ProjectTrustStore, SessionManager } from "@earendil-works/pi-coding-agent";
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

async function startSessionWithSettings(settings?: Record<string, unknown>, projectTrusted?: boolean, persist = false) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-model-catalog-"));
  tempDirs.push(root);
  const agentDir = join(root, "agent");
  const dataDir = join(root, "data");
  const workspace = join(root, "workspace");
  await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(dataDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
  if (projectTrusted !== undefined) {
    await mkdir(join(workspace, ".pi"));
    await writeFile(join(workspace, ".pi", "settings.json"), JSON.stringify({ enabledModels: [`${PROVIDER}/${DEFAULT_MODEL}`] }));
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: projectTrusted ? "always" : "never" }));
  }
  const settingsScope = resolveSettingsScopeDirectory({ dataDir, cwd: workspace, mode: "normal" });
  const settingsPath = preferencesFilePath(settingsScope);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(PROVIDER, () => Promise.resolve({ type: "api_key", key: "sk-test" }));
  const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
  if (settings !== undefined) {
    await mkdir(settingsScope, { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings));
  }
  const gateway = sessionGateway([]);
  gateway.create = (cwd) => {
    if (!persist) return SessionManager.inMemory(cwd);
    const manager = SessionManager.create(cwd, join(root, "sessions"));
    manager.appendMessage({
      role: "assistant", content: [{ type: "text", text: "Saved conversation" }],
      api: "anthropic-messages", provider: PROVIDER, model: FIRST_MODEL,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: 1,
    });
    return manager;
  };
  gateway.open = (path) => SessionManager.open(path);
  const events = new CapturingSessionEventHub();
  const service = new PiSessionService(events, {
    agentDir,
    dataDir,
    modelRuntime,
    sessionManager: gateway,
    heartbeatIntervalMs: 60_000,
  });
  try {
    const created = await service.start(workspace);
    return { service, events, modelRuntime, ref: { id: created.id, cwd: workspace }, settingsPath, workspace };
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

describe("PiSessionService session default pins", () => {
  it.each([false, true])("uses the session's project trust when saving a default model (trusted=%s)", async (trusted) => {
    const { service, ref } = await startSessionWithSettings(undefined, trusted);
    try {
      const catalog = await service.modelCatalog(ref);
      expect(catalog.find((model) => model.id === FIRST_MODEL)?.enabled).toBe(!trusted);
      const save = service.setSessionDefaults(ref, { provider: PROVIDER, modelId: FIRST_MODEL });
      if (trusted) await expect(save).rejects.toThrow("模型未启用");
      else await expect(save).resolves.toMatchObject({ defaultModel: FIRST_MODEL });
    } finally { await service.dispose(); }
  });
  it("pins a future-session model and thinking level into the project preference file", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings();
    const agentSettings = join(settingsPath, "..", "..", "..", "..", "agent", "settings.json");
    try {
      await expect(service.setSessionDefaults(ref, { provider: PROVIDER, modelId: "missing" })).rejects.toThrow(/未找到模型/);
      const pinnedModel = await service.setSessionDefaults(ref, { provider: PROVIDER, modelId: FIRST_MODEL });
      const pinnedThinking = await service.setSessionDefaults(ref, { thinkingLevel: "high" });

      expect(pinnedModel).toMatchObject({ defaultProvider: PROVIDER, defaultModel: FIRST_MODEL });
      expect(pinnedThinking.defaultThinkingLevel).toBe("high");
      expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
        defaultProvider: PROVIDER,
        defaultModel: FIRST_MODEL,
        defaultThinkingLevel: "high",
      });
      await expect(readFile(agentSettings, "utf8")).rejects.toThrow();
    } finally {
      await service.dispose();
    }
  });

  it("rejects a model pin outside the enabled set without writing preferences", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings({
      enabledModels: [`${PROVIDER}/${DEFAULT_MODEL}`],
    });
    try {
      await expect(service.setSessionDefaults(ref, { provider: PROVIDER, modelId: FIRST_MODEL })).rejects.toThrow(/模型未启用/);
      expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
        enabledModels: [`${PROVIDER}/${DEFAULT_MODEL}`],
      });
    } finally {
      await service.dispose();
    }
  });
});

describe("PiSessionService model catalog", () => {
  it.each(["command", "reopen"])("reloads externally edited model scope via %s and synchronizes existing sessions", async (mode) => {
    const { service, ref, settingsPath, workspace } = await startSessionWithSettings({
      enabledModels: [`${PROVIDER}/${FIRST_MODEL}`],
    }, undefined, mode === "reopen");
    const reload = async () => {
      if (mode === "reopen") await service.reload(ref);
      else await expect(service.runCommand(ref, "/reload")).resolves.toMatchObject({ type: "done" });
    };
    try {
      const second = await service.start(workspace);
      const secondRef = { id: second.id, cwd: workspace };
      expect(catalogIds((await service.modelCatalog(ref)).filter((model) => model.enabled))).toEqual([`${PROVIDER}/${FIRST_MODEL}`]);
      await service.modelCatalog(secondRef);
      await writeFile(settingsPath, JSON.stringify({ enabledModels: [`${PROVIDER}/${DEFAULT_MODEL}`] }));

      await reload();

      for (const target of [ref, secondRef]) {
        expect(catalogIds((await service.modelCatalog(target)).filter((model) => model.enabled))).toEqual([`${PROVIDER}/${DEFAULT_MODEL}`]);
        expect((await service.availableModels(target)).map((model) => model.id)).toEqual([DEFAULT_MODEL]);
      }
      await writeFile(settingsPath, JSON.stringify({}));
      await reload();
      expect((await service.modelCatalog(ref)).every((model) => model.enabled)).toBe(true);
    } finally {
      await service.dispose();
    }
  });

  it("marks every available model enabled in catalog order when no scope is configured", async () => {
    const { service, ref, modelRuntime } = await startSessionWithSettings();
    try {
      const catalog = await service.modelCatalog(ref);
      const snapshotIds = catalogIds(modelRuntime.getAvailableSnapshot());

      expect(catalog.length).toBeGreaterThan(1);
      expect(catalogIds(catalog)).toEqual(snapshotIds);
      expect(catalog.every((entry) => entry.enabled)).toBe(true);
      expect(catalog.map((entry) => entry.catalogIndex)).toEqual(snapshotIds.map((_, index) => index));
      const first = catalog[0];
      expect(first?.provider).toBe(PROVIDER);
      expect(typeof first?.name).toBe("string");
      expect(typeof first?.contextWindow).toBe("number");
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
      await expect(service.setModelScope(ref, "all", managementContext()))
        .rejects.toThrow("管理嵌入模式不允许修改已启用模型范围");
      await expectPersistedEnabledModels(settingsPath, [`${PROVIDER}/${FIRST_MODEL}`]);
    } finally {
      await service.dispose();
    }
  });

  it("applies atomic scope presets and synchronizes another session in the same project scope", async () => {
    const { service, events, ref, settingsPath, workspace } = await startSessionWithSettings();
    try {
      const second = await service.start(workspace);
      const secondRef = { id: second.id, cwd: workspace };
      const current = (await service.status(ref)).model;
      if (current?.provider === undefined || current.id === undefined) throw new Error("expected a current model");
      const currentScopeId = `${current.provider}/${current.id}`;

      const narrowed = await service.setModelScope(ref, "current");
      expect(narrowed.filter((entry) => entry.enabled).map((entry) => `${entry.provider}/${entry.id}`)).toEqual([currentScopeId]);
      expect(catalogIds((await service.availableModels(secondRef)).map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })))).toEqual([currentScopeId]);
      expect(events.globalEvents.some((event) => event.type === "models.changed")).toBe(true);
      await expectPersistedEnabledModels(settingsPath, [currentScopeId]);

      const restored = await service.setModelScope(ref, "all");
      expect(restored.every((entry) => entry.enabled)).toBe(true);
      await expectPersistedEnabledModels(settingsPath, undefined);
    } finally {
      await service.dispose();
    }
  });
});

describe("PiSessionService upstream model catalog contract in project scope", () => {
  it("persists each pin in the owning project preferences, preserves external edits, and leaves current session state unchanged", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings({ defaultProvider: PROVIDER, defaultModel: DEFAULT_MODEL, defaultThinkingLevel: "low" });
    try {
      const before = await service.status(ref);
      const messages = await service.messages(ref);
      await mkdir(join(ref.cwd, ".pi"), { recursive: true });
      await writeFile(join(ref.cwd, ".pi", "settings.json"), JSON.stringify({ defaultModel: "project-model", defaultThinkingLevel: "off" }));
      expect(await service.getSessionDefaults(ref)).toEqual({ defaultProvider: PROVIDER, defaultModel: DEFAULT_MODEL, defaultThinkingLevel: "low" });
      expect(await service.setSessionDefaults(ref, { provider: PROVIDER, modelId: FIRST_MODEL })).toEqual({ defaultProvider: PROVIDER, defaultModel: FIRST_MODEL, defaultThinkingLevel: "low" });
      const path = settingsPath;
      const persisted: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!isJsonObject(persisted)) throw new Error("Expected persisted settings object");
      await writeFile(path, JSON.stringify({ ...persisted, defaultModel: DEFAULT_MODEL, customSetting: "external edit" }));
      expect(await service.setSessionDefaults(ref, { thinkingLevel: "max" })).toEqual({ defaultProvider: PROVIDER, defaultModel: DEFAULT_MODEL, defaultThinkingLevel: "max" });
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ defaultThinkingLevel: "max", customSetting: "external edit" });
      expect(JSON.parse(await readFile(join(ref.cwd, ".pi", "settings.json"), "utf8"))).toEqual({ defaultModel: "project-model", defaultThinkingLevel: "off" });
      const after = await service.status(ref);
      expect(after.model).toEqual(before.model);
      expect(after.thinkingLevel).toEqual(before.thinkingLevel);
      expect(await service.messages(ref)).toEqual(messages);
    } finally {
      await service.dispose();
    }
  });

  it("rejects disabled/unavailable models and malformed settings without overwriting them", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings({ enabledModels: [`${PROVIDER}/${DEFAULT_MODEL}`] });
    try {
      const path = settingsPath;
      const before = await readFile(path, "utf8");
      await expect(service.setSessionDefaults(ref, { provider: PROVIDER, modelId: FIRST_MODEL })).rejects.toThrow("模型未启用");
      await expect(service.setSessionDefaults(ref, { provider: PROVIDER, modelId: "missing" })).rejects.toThrow("未找到模型");
      await expect(service.setSessionDefaults(ref, { provider: PROVIDER })).rejects.toThrow("provider and modelId must both be non-empty strings");
      expect(await readFile(path, "utf8")).toBe(before);
      await writeFile(path, "{malformed");
      await expect(service.getSessionDefaults(ref)).rejects.toThrow("默认值设置失败");
      await expect(service.setSessionDefaults(ref, { thinkingLevel: "high" })).rejects.toThrow("默认值设置失败");
      expect(await readFile(path, "utf8")).toBe("{malformed");
    } finally {
      await service.dispose();
    }
  });

  it("lists enabled models first in scoped order with the rest of the catalog below", async () => {
    const { service, ref } = await startSessionWithSettings({
      enabledModels: [`${PROVIDER}/${FIRST_MODEL}`, `${PROVIDER}/${DEFAULT_MODEL}`],
    });
    try {
      const catalog = await service.modelCatalog(ref);

      expect(catalogIds(catalog.slice(0, 2))).toEqual([`${PROVIDER}/${FIRST_MODEL}`, `${PROVIDER}/${DEFAULT_MODEL}`]);
      expect(catalog.slice(0, 2).map((entry) => entry.enabled)).toEqual([true, true]);
      const naturalIds = catalogIds(modelRuntime.getAvailableSnapshot());
      expect(catalog.every((entry) => naturalIds[entry.catalogIndex ?? -1] === `${entry.provider}/${entry.id}`)).toBe(true);
      const rest = catalog.slice(2);
      expect(rest.length).toBeGreaterThan(0);
      expect(rest.every((entry) => !entry.enabled)).toBe(true);
      expect([...catalogIds(catalog)].sort()).toEqual([...catalogIds(modelRuntime.getAvailableSnapshot())].sort());
    } finally {
      await service.dispose();
    }
  });

  it("persists a disable edit as an explicit list and narrows the live session scope", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings(undefined);
    try {
      const catalog = await service.modelCatalog(ref);
      const target = catalog[0];
      if (target === undefined) throw new Error("expected a catalog entry");
      const remainingIds = catalogIds(catalog).filter((id) => id !== `${target.provider}/${target.id}`);

      const updated = await service.setModelEnabled(ref, target.provider, target.id, false);

      expect(updated.find((entry) => entry.provider === target.provider && entry.id === target.id)?.enabled).toBe(false);
      expect(catalogIds(updated)).toEqual([...remainingIds, `${target.provider}/${target.id}`]);
      await expectPersistedEnabledModels(settingsPath, remainingIds);
      // The live scope follows immediately: the pickable models exclude the disabled one.
      expect(catalogIds((await service.availableModels(ref)).map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })))).toEqual(remainingIds);
    } finally {
      await service.dispose();
    }
  });

  it("lazily projects a scope change into another active session", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-model-scope-sync-"));
    tempDirs.push(root);
    const agentDir = join(root, "agent");
    const workspace = join(root, "workspace");
    await mkdir(agentDir, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const settingsPath = preferencesFilePath(resolveSettingsScopeDirectory({ dataDir: root, cwd: workspace, mode: "normal" }));
    await mkdir(join(settingsPath, ".."), { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ enabledModels: [`${PROVIDER}/${FIRST_MODEL}`] }));

    const hub = new CapturingSessionEventHub();
    const gateway = sessionGateway([]);
    gateway.create = (cwd) => SessionManager.inMemory(cwd);
    const service = new PiSessionService(hub, {
      agentDir,
      dataDir: root,
      modelRuntime,
      sessionManager: gateway,
      heartbeatIntervalMs: 60_000,
    });
    try {
      const first = await service.start(workspace);
      const second = await service.start(workspace);
      const secondRef = { id: second.id, cwd: workspace };
      const before = await service.availableModels(secondRef);
      expect(catalogIds(before.map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })))).toEqual([`${PROVIDER}/${FIRST_MODEL}`]);

      const target = modelRuntime.getAvailableSnapshot().find((model) => model.id !== FIRST_MODEL);
      if (target === undefined) throw new Error("expected a second available model");
      await service.setModelEnabled({ id: first.id, cwd: workspace }, target.provider, target.id, true);

      expect(catalogIds((await service.availableModels(secondRef)).map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })))).toEqual([
        `${PROVIDER}/${FIRST_MODEL}`,
        `${target.provider}/${target.id}`,
      ]);
      expect((await service.modelCatalog(secondRef)).find((entry) => entry.provider === target.provider && entry.id === target.id)?.enabled).toBe(true);
      expect(hub.globalEvents).toContainEqual({ type: "models.changed", revision: 1 });
    } finally {
      await service.dispose();
    }
  });

  it("keeps a workspace enabled-model override isolated from global edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-model-scope-domains-"));
    tempDirs.push(root);
    const agentDir = join(root, "agent");
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    await mkdir(agentDir, { recursive: true });
    await mkdir(join(workspaceA, ".pi"), { recursive: true });
    await mkdir(workspaceB, { recursive: true });
    for (const cwd of [workspaceA, workspaceB]) {
      const settingsPath = preferencesFilePath(resolveSettingsScopeDirectory({ dataDir: root, cwd, mode: "normal" }));
      await mkdir(join(settingsPath, ".."), { recursive: true });
      await writeFile(settingsPath, JSON.stringify({ enabledModels: [`${PROVIDER}/${FIRST_MODEL}`] }));
    }
    await writeFile(join(workspaceA, ".pi", "settings.json"), JSON.stringify({ enabledModels: [`${PROVIDER}/${FIRST_MODEL}`, `${PROVIDER}/${DEFAULT_MODEL}`] }));
    new ProjectTrustStore(agentDir).set(workspaceA, true);

    const hub = new CapturingSessionEventHub();
    const gateway = sessionGateway([]);
    gateway.create = (cwd) => SessionManager.inMemory(cwd);
    const service = new PiSessionService(hub, {
      agentDir,
      dataDir: root,
      modelRuntime,
      sessionManager: gateway,
      heartbeatIntervalMs: 60_000,
    });
    try {
      const globalSession = await service.start(workspaceB);
      const projectSession = await service.start(workspaceA);
      const projectRef = { id: projectSession.id, cwd: workspaceA };
      const globalRef = { id: globalSession.id, cwd: workspaceB };
      expect(catalogIds((await service.availableModels(globalRef)).map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })))).toEqual([`${PROVIDER}/${FIRST_MODEL}`]);
      const projectIds = catalogIds((await service.availableModels(projectRef)).map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })));
      expect(projectIds).toEqual([`${PROVIDER}/${FIRST_MODEL}`, `${PROVIDER}/${DEFAULT_MODEL}`]);

      const target = modelRuntime.getAvailableSnapshot().find((model) => !projectIds.includes(`${model.provider}/${model.id}`));
      if (target === undefined) throw new Error("expected a model outside the project override");
      await service.setModelEnabled(globalRef, target.provider, target.id, true);

      expect(catalogIds((await service.availableModels(globalRef)).map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })))).toEqual([
        `${PROVIDER}/${FIRST_MODEL}`,
        `${target.provider}/${target.id}`,
      ]);
      expect(catalogIds((await service.availableModels(projectRef)).map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })))).toEqual(projectIds);
      expect((await service.modelCatalog(projectRef)).every((entry) => entry.editable === false)).toBe(true);
      expect((await service.modelCatalog(globalRef)).every((entry) => entry.editable !== false)).toBe(true);
      await expect(service.setModelScope(projectRef, "all")).rejects.toThrow(".pi/settings.json");
      expect(hub.globalEvents).toContainEqual({ type: "models.changed", revision: 1 });
    } finally {
      await service.dispose();
    }
  });

  it("serializes concurrent per-model edits so neither update is lost", async () => {
    const { service, ref } = await startSessionWithSettings(undefined);
    try {
      const current = (await service.status(ref)).model;
      const currentId = current?.provider === undefined || current.id === undefined ? undefined : `${current.provider}/${current.id}`;
      const targets = (await service.modelCatalog(ref)).filter((entry) => `${entry.provider}/${entry.id}` !== currentId).slice(0, 2);
      expect(targets).toHaveLength(2);

      await Promise.all(targets.map((target) => service.setModelEnabled(ref, target.provider, target.id, false)));

      const updated = await service.modelCatalog(ref);
      for (const target of targets) {
        expect(updated.find((entry) => entry.provider === target.provider && entry.id === target.id)?.enabled).toBe(false);
      }
    } finally {
      await service.dispose();
    }
  });

  it("atomically narrows to the current model and clears the setting when selecting all", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings(undefined);
    try {
      const status = await service.status(ref);
      const current = status.model;
      if (current?.provider === undefined || current.id === undefined) throw new Error("expected a current model");
      const currentId = `${current.provider}/${current.id}`;

      const narrowed = await service.setModelScope(ref, "current");

      expect(catalogIds(narrowed.filter((entry) => entry.enabled))).toEqual([currentId]);
      await expectPersistedEnabledModels(settingsPath, [currentId]);
      expect(catalogIds((await service.availableModels(ref)).map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })))).toEqual([currentId]);
      await expect(service.setModelEnabled(ref, current.provider, current.id, false)).rejects.toThrow("不能停用当前模型");

      const all = await service.setModelScope(ref, "all");

      expect(all.every((entry) => entry.enabled)).toBe(true);
      await expectPersistedEnabledModels(settingsPath, undefined);
    } finally {
      await service.dispose();
    }
  });

  it("normalizes re-enabling everything back to no scope, live and on disk", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings(undefined);
    try {
      const catalog = await service.modelCatalog(ref);
      const target = catalog[0];
      if (target === undefined) throw new Error("expected a catalog entry");

      await service.setModelEnabled(ref, target.provider, target.id, false);
      const restored = await service.setModelEnabled(ref, target.provider, target.id, true);

      expect(restored.every((entry) => entry.enabled)).toBe(true);
      // The response is the fresh post-edit read: no scope, so plain catalog order.
      expect(catalogIds(restored)).toEqual(catalogIds(catalog));
      await expectPersistedEnabledModels(settingsPath, undefined);
      expect(catalogIds((await service.availableModels(ref)).map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })))).toEqual(catalogIds(catalog));
    } finally {
      await service.dispose();
    }
  });

  it("resolves configured glob patterns to explicit ids when an edit is persisted, like pi's selector", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings({ enabledModels: [`${PROVIDER}/*sonnet*`] });
    try {
      const catalog = await service.modelCatalog(ref);
      const matchedIds = catalogIds(catalog.filter((entry) => entry.enabled));
      expect(matchedIds.length).toBeGreaterThan(0);
      expect(matchedIds.every((id) => id.includes("sonnet"))).toBe(true);
      const target = catalog.find((entry) => !entry.enabled);
      if (target === undefined) throw new Error("expected a disabled catalog entry");

      const updated = await service.setModelEnabled(ref, target.provider, target.id, true);

      expect(updated.find((entry) => entry.provider === target.provider && entry.id === target.id)?.enabled).toBe(true);
      await expectPersistedEnabledModels(settingsPath, [...matchedIds, `${target.provider}/${target.id}`]);
    } finally {
      await service.dispose();
    }
  });

  it("keeps stale no-match patterns through an edit, mirroring pi", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings({ enabledModels: ["anthropic/not-a-real-model"] });
    try {
      const catalog = await service.modelCatalog(ref);
      expect(catalog.every((entry) => !entry.enabled)).toBe(true);
      const target = catalog[0];
      if (target === undefined) throw new Error("expected a catalog entry");

      await service.setModelEnabled(ref, target.provider, target.id, true);

      await expectPersistedEnabledModels(settingsPath, ["anthropic/not-a-real-model", `${target.provider}/${target.id}`]);
      expect(catalogIds((await service.availableModels(ref)).map((model) => ({ provider: model.provider ?? "", id: model.id ?? "" })))).toEqual([`${target.provider}/${target.id}`]);
    } finally {
      await service.dispose();
    }
  });

  it("rejects an unknown model without touching the persisted scope", async () => {
    const { service, ref, settingsPath } = await startSessionWithSettings({ enabledModels: [`${PROVIDER}/${FIRST_MODEL}`] });
    try {
      await expect(service.setModelEnabled(ref, PROVIDER, "not-a-real-model", true)).rejects.toThrow(`未找到模型：${PROVIDER}/not-a-real-model`);
      expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({ enabledModels: [`${PROVIDER}/${FIRST_MODEL}`] });
    } finally {
      await service.dispose();
    }
  });
});

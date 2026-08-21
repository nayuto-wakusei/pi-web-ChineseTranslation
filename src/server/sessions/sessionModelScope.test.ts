import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it } from "vitest";
import { applyEnabledModelToggle, catalogWithEnabledFirst, liveScopedModelIds, persistedEnabledModelPatterns, resolveEnabledModelIds, resolveSessionModelOptions } from "./sessionModelScope.js";

const PROVIDER = "anthropic";
const FIRST_MODEL = "claude-opus-4-6";
const DEFAULT_MODEL = "claude-sonnet-4-5";

let modelRuntime: ModelRuntime;

beforeAll(async () => {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(PROVIDER, () => Promise.resolve({ type: "api_key", key: "sk-test" }));
  modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
});

function services(settings: { enabledModels?: string[]; defaultProvider?: string; defaultModel?: string }) {
  return { modelRuntime, settingsManager: SettingsManager.inMemory(settings) };
}

describe("resolveSessionModelOptions", () => {
  it("preserves scope order and selects an in-scope saved default", async () => {
    const resolved = await resolveSessionModelOptions({
      services: services({
        enabledModels: [`${PROVIDER}/${FIRST_MODEL}:high`, `${PROVIDER}/${DEFAULT_MODEL}:low`],
        defaultProvider: PROVIDER,
        defaultModel: DEFAULT_MODEL,
      }),
      hasExistingSession: false,
    });

    expect(resolved.scopedModels.map(({ model, thinkingLevel }) => ({ id: model.id, thinkingLevel }))).toEqual([
      { id: FIRST_MODEL, thinkingLevel: "high" },
      { id: DEFAULT_MODEL, thinkingLevel: "low" },
    ]);
    expect(resolved.model?.id).toBe(DEFAULT_MODEL);
    expect(resolved.thinkingLevel).toBe("low");
  });

  it("keeps an explicit model outside scope while populating the cycle scope", async () => {
    const explicitModel = modelRuntime.getModel(PROVIDER, DEFAULT_MODEL);
    if (explicitModel === undefined) throw new Error("expected model fixture");

    const resolved = await resolveSessionModelOptions({
      services: services({ enabledModels: [`${PROVIDER}/${FIRST_MODEL}`] }),
      hasExistingSession: false,
      initialModel: explicitModel,
      initialThinkingLevel: "minimal",
    });

    expect(resolved.model).toBe(explicitModel);
    expect(resolved.thinkingLevel).toBe("minimal");
    expect(resolved.scopedModels.map(({ model }) => model.id)).toEqual([FIRST_MODEL]);
  });

  it("does not override a restored session model", async () => {
    const resolved = await resolveSessionModelOptions({
      services: services({ enabledModels: [`${PROVIDER}/${FIRST_MODEL}`] }),
      hasExistingSession: true,
    });

    expect(resolved.model).toBeUndefined();
    expect(resolved.scopedModels.map(({ model }) => model.id)).toEqual([FIRST_MODEL]);
  });

  it("reports unmatched patterns without blocking startup", async () => {
    const resolved = await resolveSessionModelOptions({
      services: services({ enabledModels: ["anthropic/not-a-real-model"] }),
      hasExistingSession: false,
    });

    expect(resolved.scopedModels).toEqual([]);
    expect(resolved.diagnostics).toEqual([{
      type: "warning",
      message: 'No models match pattern "anthropic/not-a-real-model"',
    }]);
  });
});

describe("enabled model scope helpers", () => {
  const availableIds = ["anthropic/a", "anthropic/b", "openai/c"];

  it("prefers the live scope and preserves stale stored patterns", async () => {
    await expect(resolveEnabledModelIds({
      settingsManager: SettingsManager.inMemory({ enabledModels: ["anthropic/gone"] }),
      modelRuntime,
      scopedModels: [{ model: { provider: PROVIDER, id: FIRST_MODEL } }],
    })).resolves.toEqual([`${PROVIDER}/${FIRST_MODEL}`]);

    await expect(resolveEnabledModelIds({
      settingsManager: SettingsManager.inMemory({ enabledModels: ["anthropic/not-a-real-model"] }),
      modelRuntime,
      scopedModels: [],
    })).resolves.toEqual(["anthropic/not-a-real-model"]);
  });

  it("applies toggles and normalizes all-enabled storage and live state", () => {
    expect(applyEnabledModelToggle(null, availableIds, "anthropic/a", false)).toEqual(["anthropic/b", "openai/c"]);
    expect(applyEnabledModelToggle(["anthropic/b"], availableIds, "openai/c", true)).toEqual(["anthropic/b", "openai/c"]);
    expect(persistedEnabledModelPatterns(availableIds, availableIds)).toBeUndefined();
    expect(liveScopedModelIds(availableIds, availableIds)).toBeNull();
    expect(liveScopedModelIds(["anthropic/b"], availableIds)).toEqual(["anthropic/b"]);
  });

  it("lists enabled rows first in scope order", () => {
    const available = [
      { provider: "anthropic", id: "a" },
      { provider: "anthropic", id: "b" },
      { provider: "openai", id: "c" },
    ];

    expect(catalogWithEnabledFirst(available, ["openai/c", "anthropic/a"])).toEqual([
      { model: available[2], enabled: true },
      { model: available[0], enabled: true },
      { model: available[1], enabled: false },
    ]);
  });
});

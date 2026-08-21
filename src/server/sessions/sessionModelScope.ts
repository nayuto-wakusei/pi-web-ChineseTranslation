import { modelsAreEqual } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  resolveModelScopeWithDiagnostics,
  type AgentSessionRuntimeDiagnostic,
  type ExtensionContext,
  type ModelRuntime,
  type ScopedModel,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";

type SessionModel = NonNullable<ExtensionContext["model"]>;

interface ResolveSessionModelOptionsInput {
  services: {
    modelRuntime: ModelRuntime;
    settingsManager: Pick<SettingsManager, "getDefaultModel" | "getDefaultProvider" | "getEnabledModels">;
  };
  hasExistingSession: boolean;
  initialModel?: SessionModel;
  initialThinkingLevel?: ThinkingLevel;
}

export interface ResolvedSessionModelOptions {
  scopedModels: ScopedModel[];
  diagnostics: AgentSessionRuntimeDiagnostic[];
  model?: SessionModel;
  thinkingLevel?: ThinkingLevel;
}

/** Resolve Pi's cwd-bound cycling scope without overriding explicit or restored session state. */
export async function resolveSessionModelOptions(input: ResolveSessionModelOptionsInput): Promise<ResolvedSessionModelOptions> {
  const patterns = input.services.settingsManager.getEnabledModels();
  const resolved = patterns !== undefined && patterns.length > 0
    ? await resolveModelScopeWithDiagnostics(patterns, input.services.modelRuntime)
    : { scopedModels: [], diagnostics: [] };
  const diagnostics: AgentSessionRuntimeDiagnostic[] = resolved.diagnostics.map((diagnostic) => ({
    type: diagnostic.type,
    message: diagnostic.message,
  }));

  if (input.initialModel !== undefined) {
    return {
      scopedModels: resolved.scopedModels,
      diagnostics,
      model: input.initialModel,
      ...(input.initialThinkingLevel === undefined ? {} : { thinkingLevel: input.initialThinkingLevel }),
    };
  }
  if (input.hasExistingSession || resolved.scopedModels.length === 0) {
    return {
      scopedModels: resolved.scopedModels,
      diagnostics,
      ...(input.initialThinkingLevel === undefined ? {} : { thinkingLevel: input.initialThinkingLevel }),
    };
  }

  const defaultProvider = input.services.settingsManager.getDefaultProvider();
  const defaultModelId = input.services.settingsManager.getDefaultModel();
  const defaultModel = defaultProvider !== undefined && defaultModelId !== undefined
    ? input.services.modelRuntime.getModel(defaultProvider, defaultModelId)
    : undefined;
  const selected = defaultModel === undefined
    ? resolved.scopedModels[0]
    : resolved.scopedModels.find((candidate) => modelsAreEqual(candidate.model, defaultModel)) ?? resolved.scopedModels[0];
  if (selected === undefined) throw new Error("Scoped model resolution returned an empty selection");

  return {
    scopedModels: resolved.scopedModels,
    diagnostics,
    model: selected.model,
    ...(input.initialThinkingLevel !== undefined
      ? { thinkingLevel: input.initialThinkingLevel }
      : selected.thinkingLevel === undefined ? {} : { thinkingLevel: selected.thinkingLevel }),
  };
}

export function modelScopeId(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

/** Resolve the effective enabled ids, preferring a live session scope over stored patterns. */
export async function resolveEnabledModelIds(input: {
  settingsManager: Pick<SettingsManager, "getEnabledModels">;
  modelRuntime: ModelRuntime;
  scopedModels: readonly { model: { provider: string; id: string } }[];
}): Promise<readonly string[] | null> {
  if (input.scopedModels.length > 0) return input.scopedModels.map((scoped) => modelScopeId(scoped.model));
  const patterns = input.settingsManager.getEnabledModels();
  if (patterns === undefined || patterns.length === 0) return null;
  const resolved = await resolveModelScopeWithDiagnostics([...patterns], input.modelRuntime);
  const ids = resolved.scopedModels.map((scoped) => modelScopeId(scoped.model));
  for (const diagnostic of resolved.diagnostics) {
    if (diagnostic.code === "no-match" && !ids.includes(diagnostic.pattern)) ids.push(diagnostic.pattern);
  }
  return ids;
}

export function applyEnabledModelToggle(
  currentIds: readonly string[] | null,
  availableIds: readonly string[],
  targetId: string,
  enabled: boolean,
): readonly string[] | null {
  if (currentIds === null) return enabled ? null : availableIds.filter((id) => id !== targetId);
  if (enabled) return currentIds.includes(targetId) ? currentIds : [...currentIds, targetId];
  return currentIds.includes(targetId) ? currentIds.filter((id) => id !== targetId) : currentIds;
}

export function persistedEnabledModelPatterns(enabledIds: readonly string[] | null, availableIds: readonly string[]): string[] | undefined {
  if (enabledIds === null) return undefined;
  const allEnabled = enabledIds.length === availableIds.length && enabledIds.every((id) => availableIds.includes(id));
  return allEnabled ? undefined : [...enabledIds];
}

export function liveScopedModelIds(enabledIds: readonly string[] | null, availableIds: readonly string[]): readonly string[] | null {
  if (enabledIds === null) return null;
  const hasEnabledAvailableModel = enabledIds.some((id) => availableIds.includes(id));
  const allAvailableModelsEnabled = availableIds.every((id) => enabledIds.includes(id));
  return hasEnabledAvailableModel && !allAvailableModelsEnabled ? enabledIds : null;
}

export interface EnabledModelCatalogEntry<TModel> {
  model: TModel;
  enabled: boolean;
}

/** List enabled models first in their scope order, followed by the rest of the catalog. */
export function catalogWithEnabledFirst<TModel extends { provider: string; id: string }>(
  available: readonly TModel[],
  enabledIds: readonly string[] | null,
): EnabledModelCatalogEntry<TModel>[] {
  if (enabledIds === null) return available.map((model) => ({ model, enabled: true }));
  const enabledSet = new Set(enabledIds);
  const modelsById = new Map(available.map((model) => [modelScopeId(model), model]));
  const entries: EnabledModelCatalogEntry<TModel>[] = [];
  const listed = new Set<string>();
  for (const id of enabledIds) {
    if (listed.has(id)) continue;
    const model = modelsById.get(id);
    if (model === undefined) continue;
    listed.add(id);
    entries.push({ model, enabled: true });
  }
  for (const model of available) {
    if (!enabledSet.has(modelScopeId(model))) entries.push({ model, enabled: false });
  }
  return entries;
}

import type { SessionDefaults, SessionDefaultsUpdate } from "./apiTypes.js";
import { isKnownThinkingLevel } from "./thinkingLevels.js";

/** Exactly one selector can be pinned per request; a model is always a pair. */
export function parseSessionDefaultsUpdate(value: Record<string, unknown>): SessionDefaultsUpdate {
  const { provider, modelId, thinkingLevel } = value;
  if (thinkingLevel !== undefined) {
    if (provider !== undefined || modelId !== undefined) throw new Error("只能指定模型或思考等级其中一项");
    if (typeof thinkingLevel !== "string" || !isKnownThinkingLevel(thinkingLevel)) throw new Error("无效的思考等级");
    return { thinkingLevel };
  }
  if (typeof provider !== "string" || provider.trim() === "" || typeof modelId !== "string" || modelId.trim() === "") {
    throw new Error("provider 和 modelId 都必须是非空字符串");
  }
  return { provider, modelId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSessionDefaults(value: unknown): SessionDefaults {
  if (!isRecord(value)) throw new Error("无效的会话默认值");
  const result: SessionDefaults = {};
  for (const key of ["defaultProvider", "defaultModel"] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== "string") throw new Error(`无效的 ${key}`);
    result[key] = field;
  }
  const level = value["defaultThinkingLevel"];
  if (level !== undefined) {
    if (typeof level !== "string" || !isKnownThinkingLevel(level)) throw new Error("无效的 defaultThinkingLevel");
    result.defaultThinkingLevel = level;
  }
  return result;
}

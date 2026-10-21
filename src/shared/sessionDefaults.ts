import { UserFacingError } from "./i18n.js";
import type { SessionDefaults, SessionDefaultsUpdate } from "./apiTypes.js";
import { isKnownThinkingLevel } from "./thinkingLevels.js";

/** Exactly one selector can be pinned per request; a model is always a pair. */
export function parseSessionDefaultsUpdate(value: Record<string, unknown>): SessionDefaultsUpdate {
  const { provider, modelId, thinkingLevel } = value;
  if (thinkingLevel !== undefined) {
    if (provider !== undefined || modelId !== undefined) throw new UserFacingError("server.main.3e4a6b300782", "Specify either provider/modelId or thinkingLevel");
    if (typeof thinkingLevel !== "string" || !isKnownThinkingLevel(thinkingLevel)) throw new UserFacingError("server.main.7598b259c5cc", "Invalid thinking level");
    return { thinkingLevel };
  }
  if (typeof provider !== "string" || provider.trim() === "" || typeof modelId !== "string" || modelId.trim() === "") {
    throw new UserFacingError("server.main.f7847dc4d526", "provider and modelId must both be non-empty strings");
  }
  return { provider, modelId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSessionDefaults(value: unknown): SessionDefaults {
  if (!isRecord(value)) throw new UserFacingError("server.main.b5b69396302e", "Invalid session defaults");
  const record = value;
  const result: SessionDefaults = {};
  for (const key of ["defaultProvider", "defaultModel"] as const) {
    const field = record[key];
    if (field === undefined) continue;
    if (typeof field !== "string") throw new UserFacingError("server.main.d20dbeed752b", "Invalid {arg0}", { arg0: key });
    result[key] = field;
  }
  const level = record["defaultThinkingLevel"];
  if (level !== undefined) {
    if (typeof level !== "string" || !isKnownThinkingLevel(level)) throw new UserFacingError("server.main.e937d7ab07c7", "Invalid defaultThinkingLevel");
    result.defaultThinkingLevel = level;
  }
  return result;
}

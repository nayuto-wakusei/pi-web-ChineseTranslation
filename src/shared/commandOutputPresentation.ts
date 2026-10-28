/** Explicit PI WEB provenance; extension command output remains untranslated. */
export type CommandOutputPresentation =
  | { kind: "modelAuthRemoved"; provider: string; model: string }
  | { kind: "sessionNamingFailed"; detail: string };

/** Unknown cosmetic metadata falls back to the compatible English wire message. */
export function parseCommandOutputPresentation(value: unknown): CommandOutputPresentation | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const kind: unknown = Reflect.get(value, "kind");
  if (kind === "modelAuthRemoved") {
    const provider: unknown = Reflect.get(value, "provider");
    const model: unknown = Reflect.get(value, "model");
    return typeof provider === "string" && typeof model === "string" ? { kind, provider, model } : undefined;
  }
  if (kind === "sessionNamingFailed") {
    const detail: unknown = Reflect.get(value, "detail");
    return typeof detail === "string" ? { kind, detail } : undefined;
  }
  return undefined;
}

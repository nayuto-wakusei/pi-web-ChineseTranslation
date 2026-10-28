/** PI WEB-owned notification provenance; extension messages never infer this from text. */
export const sessionNotificationSources = {
  compactionCancelled: "Compaction cancelled.",
  automaticCompactionCancelled: "Automatic compaction cancelled.",
  compactionFailed: "Couldn’t compact history. Try again.",
} as const;

export interface SessionNotificationPresentation {
  kind: keyof typeof sessionNotificationSources;
}

/** Cosmetic metadata is optional: future/malformed kinds retain the raw wire message. */
export function parseSessionNotificationPresentation(value: unknown): SessionNotificationPresentation | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const kind: unknown = Reflect.get(value, "kind");
  if (kind === "compactionCancelled" || kind === "automaticCompactionCancelled" || kind === "compactionFailed") return { kind };
  return undefined;
}

/** Explicit PI WEB-generated notice provenance; raw plugin text is never a translation key. */
export type ServerNoticePresentation =
  | { kind: "workspaceRemovalCommandFailed" }
  | { kind: "workspaceRemovalFailed"; detail: string };

/** Cosmetic metadata must not prevent an otherwise valid notice from being displayed. */
export function parseServerNoticePresentation(value: unknown): ServerNoticePresentation | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const kind: unknown = Reflect.get(value, "kind");
  if (kind === "workspaceRemovalCommandFailed") return { kind };
  const detail: unknown = Reflect.get(value, "detail");
  if (kind === "workspaceRemovalFailed" && typeof detail === "string" && detail.length <= 4096) return { kind, detail };
  return undefined;
}

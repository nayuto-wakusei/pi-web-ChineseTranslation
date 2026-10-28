/** Explicit provider provenance for host-owned workspace removal chrome. */
export interface WorkspaceRemovalLocalization {
  readonly kind: "gitWorktree";
  readonly label: string;
  readonly path: string;
}

/** Cosmetic metadata is optional; unknown versions retain provider-authored fallback text. */
export function parseWorkspaceRemovalLocalization(value: unknown): WorkspaceRemovalLocalization | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const kind: unknown = Reflect.get(value, "kind");
  const label: unknown = Reflect.get(value, "label");
  const path: unknown = Reflect.get(value, "path");
  return kind === "gitWorktree" && typeof label === "string" && typeof path === "string"
    ? Object.freeze({ kind, label, path }) : undefined;
}

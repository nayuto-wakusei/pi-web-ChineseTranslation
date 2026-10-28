import type { TerminalTitlePresentation } from "@chainingintention/pi-web-cn/plugin-api";

// The shipped Terminal graph validates its private wire/persistence metadata
// locally; public API types are erased and do not load host implementation.
export function terminalTitlePresentationField(value: unknown): { titlePresentation?: TerminalTitlePresentation } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const kind: unknown = Reflect.get(value, "kind");
  const label: unknown = Reflect.get(value, "label");
  return kind === "workspaceRemoval" && typeof label === "string" && label.length <= 4096
    ? { titlePresentation: Object.freeze({ kind, label }) } : {};
}

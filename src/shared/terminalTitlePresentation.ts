/** Explicit provenance for generated terminal titles; authored titles remain verbatim. */
export interface TerminalTitlePresentation {
  readonly kind: "workspaceRemoval";
  readonly label: string;
}

/** Invalid cosmetic metadata must not hide an otherwise valid command or terminal. */
export function parseTerminalTitlePresentation(value: unknown): TerminalTitlePresentation | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const kind: unknown = Reflect.get(value, "kind");
  const label: unknown = Reflect.get(value, "label");
  return kind === "workspaceRemoval" && typeof label === "string" && label.length <= 4096
    ? Object.freeze({ kind, label }) : undefined;
}

export function terminalTitlePresentationField(value: unknown): { titlePresentation?: TerminalTitlePresentation } {
  const titlePresentation = parseTerminalTitlePresentation(value);
  return titlePresentation === undefined ? {} : { titlePresentation };
}

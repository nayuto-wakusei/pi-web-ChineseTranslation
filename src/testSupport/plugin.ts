import type { WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";

export function createWorkspacePanelContext(patch: Partial<WorkspacePanelContext> = {}): WorkspacePanelContext {
  return {
    machine: { id: "local", name: "local", kind: "local" },
    workspace: { id: "w1", projectId: "p1", path: "/tmp/project", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false },
    files: {
      readFile: () => Promise.reject(new Error("unused")),
      listFiles: () => Promise.reject(new Error("unused")),
      writeFile: () => Promise.reject(new Error("unused")),
      deleteFile: () => Promise.reject(new Error("unused")),
      moveFile: () => Promise.reject(new Error("unused")),
    },
    prompt: { insertText: () => undefined, getText: () => "", getSelection: () => null },
    terminal: { open: () => undefined, runCommand: () => Promise.reject(new Error("unused")) },
    host: { requestRender: () => undefined },
    ...patch,
  };
}

export function serializeTemplate(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(serializeTemplate).join("");
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);

  const parts = templateParts(value);
  if (parts === undefined) return "";
  return parts.strings.reduce((output, part, index) => `${output}${part}${serializeTemplate(parts.values[index])}`, "");
}

function templateParts(value: unknown): { strings: readonly string[]; values: readonly unknown[] } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const strings: unknown = Reflect.get(value, "strings");
  const values: unknown = Reflect.get(value, "values");
  if (!Array.isArray(strings) || !strings.every((part: unknown) => typeof part === "string") || !Array.isArray(values)) return undefined;
  return { strings, values };
}

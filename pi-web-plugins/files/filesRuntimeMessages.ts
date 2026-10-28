import type { PluginLocalization } from "@chainingintention/pi-web-cn/plugin-api";
import definitions from "./filesRuntime.messages";

export type FilesRuntimeDiagnostic =
  | { key: Exclude<keyof typeof definitions, "uploadsFailed"> }
  | { key: "uploadsFailed"; count: number };

export function createFilesRuntimeMessages(localization: PluginLocalization) {
  return localization.registerMessages("runtime", definitions);
}

type RuntimeMessages = ReturnType<typeof createFilesRuntimeMessages>;

export function formatFilesRuntimeDiagnostic(diagnostic: FilesRuntimeDiagnostic, messages?: RuntimeMessages): string {
  if (diagnostic.key === "uploadsFailed") {
    return messages?.t("uploadsFailed", { count: diagnostic.count })
      ?? `${String(diagnostic.count)} ${diagnostic.count === 1 ? "file" : "files"} failed to upload`;
  }
  return messages?.t(diagnostic.key) ?? definitions[diagnostic.key].message;
}

/** Only browser-authored validation errors carry translation metadata. */
export class FilesRuntimeValidationError extends Error {
  constructor(readonly diagnostic: FilesRuntimeDiagnostic) {
    super(formatFilesRuntimeDiagnostic(diagnostic));
  }
}

/** Preserve the public string field while resolving local diagnostics at read time. */
export function setFilesRuntimeDiagnostic(
  target: object,
  key: string,
  display: () => string,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: display,
    set(value: string) {
      Object.defineProperty(this, key, { configurable: true, enumerable: true, writable: true, value });
    },
  });
}

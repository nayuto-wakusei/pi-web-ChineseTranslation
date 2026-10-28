export interface ExplorerViewState {
  expandedPaths: string[];
  scrollTop: number;
}

export interface ExplorerViewStateStore {
  read(scopeKey: string): ExplorerViewState | undefined;
  write(scopeKey: string, state: ExplorerViewState): void;
}

const STORAGE_PREFIX = "pi-web.workspace.files.explorer.v1:";

/** scopeKey is the caller's JSON-encoded machine/project/workspace identity. */
export function createExplorerViewStateStore(
  storage?: Pick<Storage, "getItem" | "setItem">,
): ExplorerViewStateStore {
  const remembered = new Map<string, ExplorerViewState>();
  let warned = false;

  function storageFailed(error: unknown): void {
    storage = undefined;
    if (warned) return;
    warned = true;
    console.warn("Files explorer state could not use session storage; using memory only.", error);
  }

  if (storage === undefined && typeof window !== "undefined") {
    try {
      storage = window.sessionStorage;
    } catch (error) {
      storageFailed(error);
    }
  }

  return {
    read(scopeKey) {
      const cached = remembered.get(scopeKey);
      if (cached !== undefined) return copyState(cached);
      if (storage === undefined) return undefined;

      let serialized: string | null;
      try {
        serialized = storage.getItem(STORAGE_PREFIX + scopeKey);
      } catch (error) {
        storageFailed(error);
        return undefined;
      }
      if (serialized === null) return undefined;

      // Invalid persisted data is not a storage outage and must not be trusted.
      let parsed: unknown;
      try {
        parsed = JSON.parse(serialized);
      } catch {
        return undefined;
      }
      const state = validateState(parsed);
      if (state === undefined) return undefined;
      remembered.set(scopeKey, state);
      return copyState(state);
    },
    write(scopeKey, state) {
      const validated = validateState(state);
      if (validated === undefined) return;
      remembered.set(scopeKey, validated);
      if (storage === undefined) return;
      try {
        storage.setItem(STORAGE_PREFIX + scopeKey, JSON.stringify(validated));
      } catch (error) {
        storageFailed(error);
      }
    },
  };
}

function validateState(value: unknown): ExplorerViewState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (!("expandedPaths" in value) || !("scrollTop" in value)) return undefined;
  const { expandedPaths, scrollTop } = value;
  if (!Array.isArray(expandedPaths)
    || !expandedPaths.every(isSafeDirectoryPath)
    || typeof scrollTop !== "number"
    || !Number.isFinite(scrollTop)
    || scrollTop < 0) return undefined;
  return { expandedPaths: [...expandedPaths], scrollTop };
}

function isSafeDirectoryPath(value: unknown): value is string {
  return typeof value === "string"
    && !value.includes("\\")
    && !/\p{Cc}/u.test(value)
    && !/^[a-z]:/iu.test(value)
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function copyState(state: ExplorerViewState): ExplorerViewState {
  return { expandedPaths: [...state.expandedPaths], scrollTop: state.scrollTop };
}

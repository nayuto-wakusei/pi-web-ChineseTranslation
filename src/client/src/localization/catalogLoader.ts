import type { LocalizationDiagnostic, TranslationCatalog, TranslationContribution } from "../../../shared/localization.js";

const CATALOG_LOAD_TIMEOUT_MS = 5_000;

export interface CatalogLoad {
  readonly ready: Promise<void>;
  readonly catalog: TranslationCatalog | undefined;
  dispose(): void;
}

/** One lazy load, with a bounded English-fallback outcome and no automatic retries. */
export function loadCatalog(contribution: TranslationContribution, report: (diagnostic: LocalizationDiagnostic) => void): CatalogLoad {
  let catalog: TranslationCatalog | undefined;
  let settle: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => { settle = resolve; });
  let pending = true;
  const finish = (value: TranslationCatalog, cause?: unknown): void => {
    if (!pending) return;
    pending = false;
    clearTimeout(timeout);
    catalog = value;
    if (cause !== undefined) report({ code: "load", message: `Could not load ${contribution.id} (${contribution.locale}/${contribution.namespace})`, cause });
    settle();
  };
  const timeout = setTimeout(() => { finish({}, new Error("Catalog loading exceeded 5 seconds; using fallback messages")); }, CATALOG_LOAD_TIMEOUT_MS);
  void Promise.resolve().then(() => pending ? contribution.load() : undefined).then((value: unknown) => {
    if (!pending) return;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Expected a translation catalog object");
    const entries: [string, string][] = [];
    for (const [key, message] of Object.entries(value)) {
      if (typeof message === "string") entries.push([key, message]);
      else report({ code: "invalid", message: `${contribution.id}: ${key}: expected an ICU string` });
    }
    finish(Object.fromEntries(entries));
  }).catch((cause: unknown) => { finish({}, cause); });
  return {
    ready,
    get catalog() { return catalog; },
    dispose() {
      if (!pending) return;
      pending = false;
      clearTimeout(timeout);
      settle();
    },
  };
}

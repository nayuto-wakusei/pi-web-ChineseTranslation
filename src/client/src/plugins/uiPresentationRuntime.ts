import type { TemplateResult } from "lit";
import type { PluginCapability, UiPresentationCapabilityV1, UiPresentationContributionV1, UiPresentationRegion, UiPresentationRenderContextV1 } from "../../../plugin-api";

export const uiPresentationRegions: readonly UiPresentationRegion[] = Object.freeze(["navigation", "context-bar", "chat-chrome", "settings-navigation", "files-toolbar"]);
export const uiPresentationCapability: UiPresentationCapabilityV1 = Object.freeze({ version: 1, regions: uiPresentationRegions });
export const uiPresentationCapabilityToken: PluginCapability<UiPresentationCapabilityV1> = Object.freeze({
  pluginId: "pi-web", id: "ui-presentation", version: 1,
  parse: (value: unknown) => {
    if (!isPresentationCapability(value)) throw new Error("UI presentation capability v1 is unavailable");
    // The host provision carries instance-bound rendering and lifecycle methods.
    return value;
  },
});

function isPresentationCapability(value: unknown): value is UiPresentationCapabilityV1 {
  return typeof value === "object" && value !== null && "version" in value && value.version === 1 && "regions" in value && Array.isArray(value.regions)
    && ["render", "subscribe", "fail"].every((key) => Reflect.get(value, key) === undefined || typeof Reflect.get(value, key) === "function");
}

export interface RegisteredUiPresentation {
  readonly id: string;
  readonly pluginId: string;
  readonly region: UiPresentationRegion;
  readonly navigationLayout?: "tree";
  readonly render: UiPresentationContributionV1["render"];
  readonly active: () => boolean;
}

/** Owns renderer selection and failure isolation, not application state or controls. */
export class UiPresentationRuntime {
  private readonly entries = new Map<UiPresentationRegion, RegisteredUiPresentation>();
  private readonly failed = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly reportError: (pluginId: string, error: unknown) => void = (pluginId, error) => { console.warn(`UI presentation failed for ${pluginId}`, error); }) {}

  isFailed(pluginId: string): boolean { return this.failed.has(pluginId); }
  hasRegion(region: UiPresentationRegion): boolean { return this.entries.has(region); }

  isActive(region: UiPresentationRegion): boolean {
    const entry = this.entries.get(region);
    return entry !== undefined && !this.failed.has(entry.pluginId) && entry.active();
  }

  navigationLayout(): "tree" | undefined {
    const entry = this.entries.get("navigation");
    return entry !== undefined && !this.failed.has(entry.pluginId) && entry.active() ? entry.navigationLayout : undefined;
  }

  register(entries: readonly RegisteredUiPresentation[]): void {
    if (entries.length === 0) return;
    const regions = new Set<UiPresentationRegion>();
    for (const entry of entries) {
      if (this.entries.has(entry.region) || regions.has(entry.region)) throw new Error(`UI presentation region ${entry.region} already has an owner`);
      regions.add(entry.region);
    }
    for (const entry of entries) this.entries.set(entry.region, entry);
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  render(context: UiPresentationRenderContextV1): TemplateResult | undefined {
    const entry = this.entries.get(context.region);
    if (entry === undefined || this.failed.has(entry.pluginId) || !entry.active()) return undefined;
    try {
      const result = entry.render(context);
      if (!isTemplateResult(result)) throw new Error(`UI presentation ${entry.id} did not return a Lit template`);
      return result;
    } catch (error) {
      this.fail(context.region, error);
      return undefined;
    }
  }

  fail(region: UiPresentationRegion, error: unknown): boolean {
    const entry = this.entries.get(region);
    return entry !== undefined && this.failPlugin(entry.pluginId, error);
  }

  failPlugin(pluginId: string, error: unknown): boolean {
    if (this.failed.has(pluginId) || ![...this.entries.values()].some((entry) => entry.pluginId === pluginId)) return false;
    this.failed.add(pluginId);
    this.reportError(pluginId, error);
    this.notify();
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.failed.clear();
    this.notify();
  }

  private notify(): void { for (const listener of this.listeners) listener(); }
}

function isTemplateResult(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && "_$litType$" in value && "strings" in value && "values" in value;
}

import { machineScopedManifestPluginId } from "../../../shared/machinePluginIds";
import { requirePluginBackendRevision } from "../../../shared/pluginBackendProtocol";
import { isPiWebBundledPluginId, isPiWebPluginId, isReservedPiWebPluginId } from "../../../shared/pluginIds";
import { withManagementEmbed } from "../api/managementEmbed";
import { resolveAppUrl, type AppUrlContext } from "../appUrl";
import type { PiWebPlugin, PiWebPluginRegistration, PiWebPluginRegistrationDeclaration } from "./types";
import { adaptPublicPlugin } from "./publicContext";

export interface PluginManifestEntry {
  id: string;
  module: string;
  source?: string;
  scope?: string;
  backendRevision?: string;
  pairedRequestVersion?: 1;
  pairedChannelVersion?: 1;
  machineSpecific: boolean;
}
interface PluginManifest {
  plugins: PluginManifestEntry[];
}

export interface LoadExternalPluginsOptions {
  machineId?: string;
  shouldLoadPlugin?: (entry: PluginManifestEntry) => boolean;
  moduleLoader?: (moduleUrl: string) => Promise<unknown>;
  plugins?: readonly PluginManifestEntry[];
}

export interface ExternalPluginLoadFailure {
  entry: PluginManifestEntry;
  error: unknown;
}

export interface ExternalPluginLoadResult {
  declarations: PiWebPluginRegistrationDeclaration[];
  registrations: PiWebPluginRegistration[];
  failures: ExternalPluginLoadFailure[];
}

export async function loadExternalPlugins(manifestUrl = "pi-web-plugins/manifest.json", options: LoadExternalPluginsOptions = {}): Promise<ExternalPluginLoadResult> {
  const resolvedManifestUrl = resolveAppUrl(withManagementEmbed(manifestUrl));
  const manifest = await fetchPluginManifest(resolvedManifestUrl, options.plugins);
  if (manifest === undefined) return { declarations: [], registrations: [], failures: [] };

  const declarations: PiWebPluginRegistrationDeclaration[] = [];
  const registrations: PiWebPluginRegistration[] = [];
  const failures: ExternalPluginLoadFailure[] = [];
  for (const entry of manifest.plugins) {
    if (options.shouldLoadPlugin?.(entry) === false) continue;
    const declaration = registrationDeclaration(entry, options.machineId);
    declarations.push(declaration);
    try {
      const moduleUrl = resolvePluginModuleUrl(entry.module, resolvedManifestUrl);
      const module = await loadPluginModule(moduleUrl, options.moduleLoader ?? importPluginModule);
      const plugin = parsePluginModule(module, moduleUrl);
      registrations.push({
        ...declaration,
        plugin,
        ...(entry.backendRevision === undefined ? {} : { backendRevision: entry.backendRevision }),
        ...(entry.pairedRequestVersion === undefined ? {} : { pairedRequestVersion: entry.pairedRequestVersion }),
        ...(entry.pairedChannelVersion === undefined ? {} : { pairedChannelVersion: entry.pairedChannelVersion }),
      });
    } catch (error) {
      failures.push({ entry, error });
    }
  }
  return { declarations, registrations, failures };
}

function registrationDeclaration(entry: PluginManifestEntry, machineId: string | undefined): PiWebPluginRegistrationDeclaration {
  return Object.freeze({
    id: machineId === undefined ? entry.id : machineScopedManifestPluginId(machineId, entry.id),
    machineSpecific: entry.machineSpecific,
    ...(entry.source === undefined ? {} : { manifestSource: entry.source }),
    ...(entry.scope === undefined ? {} : { manifestScope: entry.scope }),
    ...(machineId === undefined ? {} : { machineId, sourcePluginId: entry.id }),
  });
}

export function resolvePluginModuleUrl(moduleReference: string, manifestUrl: string, appUrlContext?: AppUrlContext): string {
  if (!moduleReference.startsWith("/")) return new URL(moduleReference, manifestUrl).toString();
  return appUrlContext === undefined ? resolveAppUrl(moduleReference) : resolveAppUrl(moduleReference, appUrlContext);
}

async function importPluginModule(moduleUrl: string): Promise<unknown> {
  return import(/* @vite-ignore */ moduleUrl);
}

async function loadPluginModule(moduleUrl: string, loader: (url: string) => Promise<unknown>): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => { reject(new Error(`Browser plugin import timed out after 10000ms: ${moduleUrl}`)); }, 10_000);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => loader(moduleUrl)), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPluginManifest(manifestUrl: string, plugins: readonly PluginManifestEntry[] | undefined): Promise<PluginManifest | undefined> {
  if (plugins !== undefined) return parseManifest({ plugins: [...plugins] });
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await pluginManifestResponseError(response));
  return parseManifest(await response.json());
}

function parseManifest(value: unknown): PluginManifest {
  if (!isRecord(value) || !Array.isArray(value["plugins"])) throw new Error("Invalid plugin manifest");
  const plugins = value["plugins"].map((entry) => {
    if (!isRecord(entry) || typeof entry["id"] !== "string" || typeof entry["module"] !== "string" || entry["module"] === "") throw new Error("Invalid plugin manifest entry");
    const id = entry["id"];
    if (!isPiWebPluginId(id)) throw new Error(`Invalid plugin manifest id: ${id}`);
    const source = typeof entry["source"] === "string" ? entry["source"] : undefined;
    const scope = typeof entry["scope"] === "string" ? entry["scope"] : undefined;
    if (isReservedPiWebPluginId(id)
      && !(isPiWebBundledPluginId(id) && source === "bundled" && scope === "bundled")) {
      throw new Error(`Reserved plugin manifest id: ${id}`);
    }
    const backendRevision = parseBackendRevision(entry["backendRevision"]);
    const pairedRequestVersion = parsePairedCapabilityVersion(entry["pairedRequestVersion"]);
    const pairedChannelVersion = parsePairedCapabilityVersion(entry["pairedChannelVersion"]);
    if ((pairedRequestVersion !== undefined || pairedChannelVersion !== undefined) && backendRevision === undefined) {
      throw new Error("Invalid plugin manifest entry");
    }
    return {
      id,
      module: entry["module"],
      ...(source === undefined ? {} : { source }),
      ...(scope === undefined ? {} : { scope }),
      ...(backendRevision === undefined ? {} : { backendRevision }),
      ...(pairedRequestVersion === undefined ? {} : { pairedRequestVersion }),
      ...(pairedChannelVersion === undefined ? {} : { pairedChannelVersion }),
      machineSpecific: parseMachineSpecific(entry["machineSpecific"]),
    };
  });
  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (ids.has(plugin.id)) throw new Error(`Duplicate plugin manifest id: ${plugin.id}`);
    ids.add(plugin.id);
  }
  return { plugins };
}

async function pluginManifestResponseError(response: Response): Promise<string> {
  let detail: string | undefined;
  try {
    const value: unknown = await response.json();
    if (isRecord(value)) {
      const error = value["error"];
      const responseDetail = value["detail"];
      detail = typeof responseDetail === "string"
        ? `${typeof error === "string" ? `${error}: ` : ""}${responseDetail}`
        : typeof error === "string" ? error : undefined;
    }
  } catch {
    // Status metadata remains a useful bounded error when the body is not JSON.
  }
  const status = `${String(response.status)}${response.statusText === "" ? "" : ` ${response.statusText}`}`;
  return `Failed to load plugin manifest (${status})${detail === undefined ? "" : `: ${detail}`}`;
}

function parseBackendRevision(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return requirePluginBackendRevision(value);
  } catch {
    throw new Error("Invalid plugin manifest entry");
  }
}

function parsePairedCapabilityVersion(value: unknown): 1 | undefined {
  if (value === undefined) return undefined;
  if (value !== 1) throw new Error("Invalid plugin manifest entry");
  return 1;
}

function parseMachineSpecific(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error("Invalid plugin manifest entry");
  return value;
}

function parsePluginModule(module: unknown, moduleUrl: string): PiWebPlugin {
  if (!isRecord(module)) throw new Error(`Plugin module ${moduleUrl} did not export an object`);
  const plugin = module["default"];
  if (isRecord(plugin) && plugin["apiVersion"] !== 4) {
    throw new Error(`Unsupported browser plugin API version for ${moduleUrl}: ${String(plugin["apiVersion"])} (expected 4)`);
  }
  if (!isPiWebPlugin(plugin)) throw new Error(`Plugin module ${moduleUrl} default export is not a PiWebPlugin`);
  return adaptPublicPlugin(plugin);
}

function isPiWebPlugin(value: unknown): value is PiWebPlugin {
  return isRecord(value) && value["apiVersion"] === 4 && typeof value["name"] === "string" && typeof value["activate"] === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

import { createTranslator, UserFacingError, userFacingErrorMessage, type Translator } from "../../shared/i18n.js";
import type { Machine, MachineHealth, MachineRuntime, PiWebComponentStatus, PiWebDeprecatedAgentInput, PiWebRuntimeComponent, PiWebRuntimeResponse, PiWebStatusResponse } from "../../shared/apiTypes.js";
import { parsePiWebRuntimeResponse } from "../../shared/piWebStatusParsing.js";
import { installationDisplayName, requireInstallationName } from "../../shared/installationName.js";
import { getPiWebRuntime } from "../piWebStatus.js";
import { DEFAULT_REMOTE_HEALTH_TIMEOUT_MS, RemoteMachineClient, type MachineClient, validateConfiguredMachineHeaders } from "./machineClient.js";
import { MachineStore, type StoredMachine } from "./machineStore.js";

export interface CreateMachineInput {
  name?: string;
  baseUrl?: string;
  token?: string;
  headers?: Record<string, string>;
}

export type UpdateMachineInput = Partial<CreateMachineInput>;

export interface MachineServiceDependencies {
  translate?: Translator;
  localRuntime?: () => Promise<PiWebRuntimeResponse>;
  localName?: () => string | undefined | Promise<string | undefined>;
  nameCacheTtlMs?: number;
  onNameDiscoveryError?: (machineId: string, error: unknown) => void;
  remoteClientFactory?: (machine: StoredMachine) => MachineClient;
  now?: () => Date;
  healthCacheTtlMs?: number;
  runtimeCacheTtlMs?: number;
}

const LOCAL_MACHINE_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const DEFAULT_HEALTH_CACHE_TTL_MS = 5_000;
const DEFAULT_NAME_CACHE_TTL_MS = 30_000;
const REMOTE_IDENTITY_TIMEOUT_MS = 1_000;

interface NameCacheEntry {
  expiresAt: number;
  reportedName: string | undefined;
  pending: Promise<void> | undefined;
}

export class MachineService {
  private readonly translate: Translator;
  // Bounded, cached discovery uses only the peer's local identity, never its federation.
  private readonly nameCache = new Map<string, NameCacheEntry>();
  private readonly healthCache = new Map<string, { expiresAt: number; health: MachineHealth }>();
  private readonly runtimeCache = new Map<string, { expiresAt: number; runtime: MachineRuntime }>();

  constructor(private readonly store = new MachineStore(), private readonly deps: MachineServiceDependencies = {}) {
    this.translate = deps.translate ?? createTranslator("en", {});
  }

  async list(): Promise<Machine[]> {
    const stored = await this.store.list();
    const remotes = await Promise.all(stored.map((machine) => this.resolveRemoteMachine(machine)));
    return [await this.localMachine(), ...remotes];
  }

  async get(id: string): Promise<Machine | undefined> {
    if (id === "local") return this.localMachine();
    const machine = (await this.store.list()).find((stored) => stored.id === id);
    return machine === undefined ? undefined : this.resolveRemoteMachine(machine);
  }

  async add(input: CreateMachineInput): Promise<Machine> {
    const name = validateName(input.name);
    const baseUrl = validateBaseUrl(input.baseUrl);
    const stored = await this.store.add({ name, baseUrl, ...optionalSecrets(input) });
    return this.resolveRemoteMachine(stored);
  }

  async update(id: string, input: UpdateMachineInput): Promise<Machine | undefined> {
    if (id === "local") throw new UserFacingError("machineError.localImmutable", "Local machine cannot be changed");
    const patch: Partial<Pick<StoredMachine, "name" | "baseUrl" | "token" | "headers">> = {};
    if (input.name !== undefined) patch.name = validateName(input.name);
    if (input.baseUrl !== undefined) patch.baseUrl = validateBaseUrl(input.baseUrl);
    if (input.token !== undefined) patch.token = input.token;
    if (input.headers !== undefined) patch.headers = validateHeaders(input.headers);
    const stored = await this.store.update(id, patch);
    if (stored !== undefined) {
      if (input.baseUrl !== undefined || input.token !== undefined || input.headers !== undefined) this.nameCache.delete(id);
      this.healthCache.delete(id);
      this.runtimeCache.delete(id);
    }
    return stored === undefined ? undefined : this.resolveRemoteMachine(stored);
  }

  invalidateReportedName(id: string): void {
    const cached = this.nameCache.get(id);
    if (cached !== undefined) {
      // Detach any in-flight read started before the write: it must not refill this entry.
      this.nameCache.set(id, { expiresAt: 0, reportedName: cached.reportedName, pending: undefined });
    }
  }

  async remove(id: string): Promise<boolean> {
    if (id === "local") throw new UserFacingError("machineError.localCannotDelete", "Local machine cannot be deleted");
    const removed = await this.store.remove(id);
    if (removed) {
      this.nameCache.delete(id);
      this.healthCache.delete(id);
      this.runtimeCache.delete(id);
    }
    return removed;
  }

  async storedRemote(id: string): Promise<StoredMachine | undefined> {
    if (id === "local") return undefined;
    return (await this.store.list()).find((machine) => machine.id === id);
  }

  async remoteClient(id: string): Promise<MachineClient | undefined> {
    const machine = await this.storedRemote(id);
    return machine === undefined ? undefined : this.clientFor(machine);
  }

  async health(id: string): Promise<MachineHealth | undefined> {
    const cached = this.healthCache.get(id);
    const now = this.now().getTime();
    if (cached !== undefined && cached.expiresAt > now) return cached.health;

    const health = id === "local" ? await this.localHealth() : await this.remoteHealth(id);
    if (health === undefined) return undefined;
    this.healthCache.set(id, { expiresAt: now + (this.deps.healthCacheTtlMs ?? DEFAULT_HEALTH_CACHE_TTL_MS), health });
    return health;
  }

  async runtime(id: string, refresh = false): Promise<MachineRuntime | undefined> {
    const cached = this.runtimeCache.get(id);
    const now = this.now().getTime();
    if (!refresh && cached !== undefined && cached.expiresAt > now) return cached.runtime;

    const runtime = id === "local" ? await this.localRuntime() : await this.remoteRuntime(id);
    if (runtime === undefined) return undefined;
    this.runtimeCache.set(id, { expiresAt: now + (this.deps.runtimeCacheTtlMs ?? DEFAULT_HEALTH_CACHE_TTL_MS), runtime });
    return runtime;
  }

  private async localHealth(): Promise<MachineHealth> {
    const checkedAt = this.now().toISOString();
    try {
      const runtime = await (this.deps.localRuntime ?? getPiWebRuntime)();
      return {
        machineId: "local",
        ok: true,
        checkedAt,
        status: "online",
        web: componentStatusFromRuntime(runtime.components.web),
        sessiond: componentStatusFromRuntime(runtime.components.sessiond),
      };
    } catch (error) {
      return { machineId: "local", ok: false, checkedAt, status: "error", error: userFacingErrorMessage(error, this.translate) };
    }
  }

  private async remoteHealth(id: string): Promise<MachineHealth | undefined> {
    const machine = await this.storedRemote(id);
    if (machine === undefined) return undefined;
    const checkedAt = this.now().toISOString();
    try {
      const response = await this.clientFor(machine).requestJson("GET", "/api/pi-web/status", undefined, { timeoutMs: DEFAULT_REMOTE_HEALTH_TIMEOUT_MS });
      if (response.statusCode >= 200 && response.statusCode < 300 && isPiWebStatusResponse(response.body)) {
        return { machineId: id, ok: true, checkedAt, status: "online", web: response.body.components.web, sessiond: response.body.components.sessiond };
      }
      return { machineId: id, ok: false, checkedAt, status: "error", error: this.translate("machineError.healthHttpStatus", "Remote health returned HTTP {status}", { status: response.statusCode }) };
    } catch (error) {
      return { machineId: id, ok: false, checkedAt, status: "offline", error: userFacingErrorMessage(error, this.translate) };
    }
  }

  private async localRuntime(): Promise<MachineRuntime> {
    const checkedAt = this.now().toISOString();
    try {
      return machineRuntime("local", checkedAt, await (this.deps.localRuntime ?? getPiWebRuntime)());
    } catch (error) {
      return { machineId: "local", ok: false, checkedAt, error: userFacingErrorMessage(error, this.translate) };
    }
  }

  private async remoteRuntime(id: string): Promise<MachineRuntime | undefined> {
    const machine = await this.storedRemote(id);
    if (machine === undefined) return undefined;
    const checkedAt = this.now().toISOString();
    try {
      const response = await this.clientFor(machine).requestJson("GET", "/api/pi-web/runtime", undefined, { timeoutMs: DEFAULT_REMOTE_HEALTH_TIMEOUT_MS });
      const runtime = parsePiWebRuntimeResponse(response.body);
      if (response.statusCode >= 200 && response.statusCode < 300 && runtime !== undefined) return machineRuntime(id, checkedAt, runtime);
      return { machineId: id, ok: false, checkedAt, error: this.translate("machineError.runtimeHttpStatus", "Remote runtime returned HTTP {status}", { status: response.statusCode }) };
    } catch (error) {
      return { machineId: id, ok: false, checkedAt, error: userFacingErrorMessage(error, this.translate) };
    }
  }

  private async localMachine(): Promise<Machine> {
    return localMachine(await this.deps.localName?.());
  }

  private async resolveRemoteMachine(machine: StoredMachine): Promise<Machine> {
    if (machine.name.trim() === "") await this.discoverName(machine);
    return publicRemoteMachine(machine, this.nameCache.get(machine.id)?.reportedName);
  }

  private discoverName(machine: StoredMachine): Promise<void> | undefined {
    const cached = this.nameCache.get(machine.id);
    if (cached?.pending !== undefined) return cached.pending;
    if (cached !== undefined && cached.expiresAt > this.now().getTime()) return;
    const entry: NameCacheEntry = { expiresAt: 0, reportedName: cached?.reportedName, pending: undefined };
    this.nameCache.set(machine.id, entry);
    entry.pending = Promise.resolve().then(async () => {
      try {
        const response = await this.clientFor(machine).requestJson("GET", "/api/pi-web/identity", undefined, { timeoutMs: REMOTE_IDENTITY_TIMEOUT_MS });
        // A peer predating installation identity has no name to report.
        if (response.statusCode === 404) return;
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new Error(`Remote installation identity returned HTTP ${String(response.statusCode)}`);
        }
        if (!isRecord(response.body)) throw new Error("Remote installation identity must be an object");
        const name = requireInstallationName(response.body["name"], "Remote installation identity name");
        if (name === "") throw new Error("Remote installation identity must have a non-empty name");
        entry.reportedName = name;
      } catch (error) {
        // Discovery must not block use of an offline peer; report failures and retain its last identity.
        this.deps.onNameDiscoveryError?.(machine.id, error);
      } finally {
        entry.expiresAt = this.now().getTime() + (this.deps.nameCacheTtlMs ?? DEFAULT_NAME_CACHE_TTL_MS);
        entry.pending = undefined;
      }
    });
    return entry.pending;
  }

  private clientFor(machine: StoredMachine): MachineClient {
    return this.deps.remoteClientFactory?.(machine) ?? new RemoteMachineClient(machine, undefined, this.translate);
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

export function localMachine(name?: string): Machine {
  return { id: "local", name: installationDisplayName(name), kind: "local", createdAt: LOCAL_MACHINE_TIMESTAMP, updatedAt: LOCAL_MACHINE_TIMESTAMP };
}

function publicRemoteMachine(machine: StoredMachine, reportedName: string | undefined): Machine {
  const nameOverride = machine.name.trim() || undefined;
  return {
    id: machine.id,
    name: nameOverride ?? installationDisplayName(reportedName),
    ...(nameOverride === undefined ? {} : { nameOverride }),
    ...(reportedName === undefined ? {} : { reportedName }),
    kind: "remote",
    baseUrl: machine.baseUrl,
    createdAt: machine.createdAt,
    updatedAt: machine.updatedAt,
  };
}

function validateName(value: string | undefined): string {
  // Empty stored names mean follow the installation; existing nonempty names remain overrides.
  return value === undefined ? "" : requireInstallationName(value, "Machine name");
}

function validateBaseUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (raw === undefined || raw === "") throw new UserFacingError("machineError.urlRequired", "Machine baseUrl is required");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UserFacingError("machineError.urlInvalid", "Machine baseUrl must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UserFacingError("machineError.urlProtocol", "Machine baseUrl must use http or https");
  if (url.username !== "" || url.password !== "") throw new UserFacingError("machineError.urlCredentials", "Machine baseUrl must not include credentials");
  if (url.search !== "" || url.hash !== "") throw new UserFacingError("machineError.urlQuery", "Machine baseUrl must not include query or hash");
  return url.href.replace(/\/$/u, "");
}

function optionalSecrets(input: CreateMachineInput): { token?: string; headers?: Record<string, string> } {
  return {
    ...(input.token === undefined ? {} : { token: input.token }),
    ...(input.headers === undefined ? {} : { headers: validateHeaders(input.headers) }),
  };
}

function validateHeaders(value: Record<string, string>): Record<string, string> {
  return validateConfiguredMachineHeaders(value) ?? {};
}

function componentStatusFromRuntime(runtime: PiWebRuntimeComponent): PiWebComponentStatus {
  return {
    component: runtime.component,
    label: runtime.label,
    ...(runtime.runtimeVersion === undefined ? {} : { runtimeVersion: runtime.runtimeVersion }),
    ...(runtime.piVersion === undefined ? {} : { piVersion: runtime.piVersion }),
    stale: false,
    available: runtime.available,
    ...(runtime.error === undefined ? {} : { error: runtime.error }),
  };
}

function machineRuntime(machineId: string, checkedAt: string, runtime: PiWebRuntimeResponse): MachineRuntime {
  const deprecatedAgentInputs = mergeComponentDeprecatedAgentInputs(runtime.components);
  return {
    machineId,
    ok: true,
    checkedAt,
    packageName: runtime.packageName,
    generatedAt: runtime.generatedAt,
    components: runtime.components,
    capabilities: runtime.capabilities,
    ...(deprecatedAgentInputs.length === 0 ? {} : { deprecatedAgentInputs }),
  };
}

/**
 * Per-machine union of the web and session daemon deprecated-input reports,
 * deduplicated by input: the config file is read by both processes, and the
 * same env var can reach both, so identical reports collapse into one warning
 * attributed to the machine rather than one per component.
 */
function mergeComponentDeprecatedAgentInputs(components: PiWebRuntimeResponse["components"]): PiWebDeprecatedAgentInput[] {
  const seen = new Set<string>();
  const merged: PiWebDeprecatedAgentInput[] = [];
  for (const component of [components.web, components.sessiond]) {
    for (const input of component.deprecatedAgentInputs ?? []) {
      const key = `${input.source}\n${input.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(input);
    }
  }
  return merged;
}

function isPiWebStatusResponse(value: unknown): value is PiWebStatusResponse {
  if (!isRecord(value)) return false;
  const components = value["components"];
  if (!isRecord(components)) return false;
  return isPiWebComponentStatus(components["web"]) && isPiWebComponentStatus(components["sessiond"]);
}

function isPiWebComponentStatus(value: unknown): value is PiWebComponentStatus {
  if (!isRecord(value)) return false;
  const component = value["component"];
  return (component === "web" || component === "sessiond")
    && typeof value["label"] === "string"
    && typeof value["stale"] === "boolean"
    && typeof value["available"] === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

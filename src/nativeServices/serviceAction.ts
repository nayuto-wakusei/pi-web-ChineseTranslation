import type { RunningComponentId } from "../piWebVersionReport.js";
import type { NativeServiceBackend, NativeServiceId, NativeServiceManagerRef } from "./servicePlan.js";

export interface LifecycleServiceRef extends NativeServiceManagerRef {
  id: NativeServiceId;
}

export type ServiceLifecycleAction = "start" | "stop" | "restart";

export const serviceStartOrder: readonly NativeServiceId[] = ["sessiond", "web", "uiDev"];
export const serviceStopOrder: readonly NativeServiceId[] = ["web", "uiDev", "sessiond"];
export const serviceRestartOrder: readonly NativeServiceId[] = ["web", "uiDev", "sessiond"];

const LAUNCHD_UNLOAD_SETTLE_TIMEOUT_MS = 10_000;
const LAUNCHD_UNLOAD_SETTLE_INTERVAL_MS = 250;
const SERVICE_READINESS_TIMEOUT_MS = 30_000;
const SERVICE_READINESS_INTERVAL_MS = 1_000;

export interface ServiceActionTiming {
  launchdUnloadSettleTimeoutMs?: number;
  launchdUnloadSettleIntervalMs?: number;
  readinessTimeoutMs?: number;
  readinessIntervalMs?: number;
}

export interface ServiceActionDeps {
  run(command: string, args: string[]): number;
  runQuiet(command: string, args: string[]): number;
  sleep(ms: number): Promise<void>;
  isServiceRunning(ref: LifecycleServiceRef): boolean;
  isComponentReady(component: RunningComponentId): Promise<boolean>;
}

export interface LaunchdServiceContext {
  domain: string;
  plistPath(ref: LifecycleServiceRef): string;
}

export class ServiceCommandError extends Error {
  readonly command: string;
  readonly args: readonly string[];
  readonly status: number;

  constructor(command: string, args: readonly string[], status: number) {
    super(`\`${command} ${args.join(" ")}\` failed with exit status ${String(status)}.`);
    this.name = "ServiceCommandError";
    this.command = command;
    this.args = args;
    this.status = status;
  }
}

export function systemctlUserActionArgs(action: ServiceLifecycleAction, unitNames: readonly string[]): string[] {
  return ["--user", action, ...unitNames];
}

export function launchdBootoutArgs(target: string): string[] {
  return ["bootout", target];
}

export function launchdPrintArgs(target: string): string[] {
  return ["print", target];
}

export function launchdBootstrapArgs(domain: string, plistPath: string): string[] {
  return ["bootstrap", domain, plistPath];
}

export function launchdEnableArgs(target: string): string[] {
  return ["enable", target];
}

export function launchdKickstartArgs(target: string): string[] {
  return ["kickstart", target];
}

export function launchdServiceTarget(domain: string, ref: LifecycleServiceRef): string {
  return `${domain}/${ref.launchdLabel}`;
}

export function orderServices<T extends LifecycleServiceRef>(refs: readonly T[], order: readonly NativeServiceId[]): T[] {
  const byId = new Map(refs.map((ref) => [ref.id, ref]));
  return order.flatMap((id) => {
    const ref = byId.get(id);
    return ref === undefined ? [] : [ref];
  });
}

function orderForAction(action: ServiceLifecycleAction): readonly NativeServiceId[] {
  if (action === "stop") return serviceStopOrder;
  if (action === "restart") return serviceRestartOrder;
  return serviceStartOrder;
}

export function readinessComponentForService(id: NativeServiceId): RunningComponentId {
  return id === "sessiond" ? "sessiond" : "web";
}

function runChecked(deps: Pick<ServiceActionDeps, "run">, command: string, args: string[]): void {
  const status = deps.run(command, args);
  if (status !== 0) throw new ServiceCommandError(command, args, status);
}

function launchdServiceLoaded(target: string, deps: Pick<ServiceActionDeps, "runQuiet">): boolean {
  return deps.runQuiet("launchctl", launchdPrintArgs(target)) === 0;
}

export async function settleLaunchdServiceUnload(
  target: string,
  deps: Pick<ServiceActionDeps, "runQuiet" | "sleep">,
  timing: ServiceActionTiming = {},
): Promise<boolean> {
  const timeoutMs = timing.launchdUnloadSettleTimeoutMs ?? LAUNCHD_UNLOAD_SETTLE_TIMEOUT_MS;
  const intervalMs = timing.launchdUnloadSettleIntervalMs ?? LAUNCHD_UNLOAD_SETTLE_INTERVAL_MS;
  const maxPolls = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let poll = 0; poll < maxPolls; poll += 1) {
    if (!launchdServiceLoaded(target, deps)) return true;
    await deps.sleep(intervalMs);
  }
  return !launchdServiceLoaded(target, deps);
}

export function startLaunchdService(
  ref: LifecycleServiceRef,
  context: LaunchdServiceContext,
  deps: Pick<ServiceActionDeps, "run" | "runQuiet">,
): void {
  const target = launchdServiceTarget(context.domain, ref);
  if (!launchdServiceLoaded(target, deps)) {
    runChecked(deps, "launchctl", launchdBootstrapArgs(context.domain, context.plistPath(ref)));
    runChecked(deps, "launchctl", launchdEnableArgs(target));
  }
  runChecked(deps, "launchctl", launchdKickstartArgs(target));
}

export async function restartLaunchdService(
  ref: LifecycleServiceRef,
  context: LaunchdServiceContext,
  deps: Pick<ServiceActionDeps, "run" | "runQuiet" | "sleep">,
  timing: ServiceActionTiming = {},
): Promise<void> {
  const target = launchdServiceTarget(context.domain, ref);
  deps.runQuiet("launchctl", launchdBootoutArgs(target));
  await settleLaunchdServiceUnload(target, deps, timing);
  startLaunchdService(ref, context, deps);
}

export async function awaitServicesReady(
  refs: readonly LifecycleServiceRef[],
  deps: Pick<ServiceActionDeps, "sleep" | "isServiceRunning" | "isComponentReady">,
  timing: ServiceActionTiming = {},
): Promise<LifecycleServiceRef[]> {
  const timeoutMs = timing.readinessTimeoutMs ?? SERVICE_READINESS_TIMEOUT_MS;
  const intervalMs = timing.readinessIntervalMs ?? SERVICE_READINESS_INTERVAL_MS;
  const maxPolls = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  const pending = new Set(refs);
  for (let poll = 0; poll < maxPolls && pending.size > 0; poll += 1) {
    for (const ref of [...pending]) {
      if (!deps.isServiceRunning(ref)) continue;
      if (await deps.isComponentReady(readinessComponentForService(ref.id))) pending.delete(ref);
    }
    if (pending.size > 0) await deps.sleep(intervalMs);
  }
  return [...pending];
}

export interface ServiceActionInput {
  backend: NativeServiceBackend;
  action: ServiceLifecycleAction;
  refs: readonly LifecycleServiceRef[];
  launchdContext: LaunchdServiceContext;
}

export interface ServiceActionResult {
  unreadyServices: LifecycleServiceRef[];
}

export async function performServiceAction(
  input: ServiceActionInput,
  deps: ServiceActionDeps,
  timing: ServiceActionTiming = {},
): Promise<ServiceActionResult> {
  const refs = orderServices(input.refs, orderForAction(input.action));
  if (refs.length === 0) return { unreadyServices: [] };

  if (input.backend.kind === "systemd") {
    runChecked(deps, "systemctl", systemctlUserActionArgs(input.action, refs.map((ref) => ref.systemdName)));
  } else if (input.action === "stop") {
    for (const ref of refs) deps.runQuiet("launchctl", launchdBootoutArgs(launchdServiceTarget(input.launchdContext.domain, ref)));
  } else if (input.action === "restart") {
    for (const ref of refs) await restartLaunchdService(ref, input.launchdContext, deps, timing);
  } else {
    for (const ref of refs) startLaunchdService(ref, input.launchdContext, deps);
  }

  if (input.action === "stop") return { unreadyServices: [] };
  return { unreadyServices: await awaitServicesReady(refs, deps, timing) };
}

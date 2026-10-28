import { isDeepStrictEqual } from "node:util";
import type { PiWebConfigValues } from "../shared/apiTypes.js";
import { PI_WEB_CONFIG_DEFINITIONS, piWebConfigNamespaceFields, piWebConfigSettingPointers } from "../shared/configResolution.js";

export interface PiWebConfigUpdate {
  set?: PiWebConfigValues;
  /** JSON pointers; namespace containers can be reset together. */
  unset?: string[];
}

export const CONFIG_KEYS: readonly string[] = [...Object.keys(PI_WEB_CONFIG_DEFINITIONS), "agent"];

export function parseConfigPointer(pointer: string): string[] {
  if (!pointer.startsWith("/") || /~(?![01])/u.test(pointer)) fail("unset identifiers must be valid JSON pointers");
  const parts = pointer.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  const [root] = parts;
  if (!CONFIG_KEYS.some((key) => key === root)) fail(`unknown setting: ${pointer}`);
  if (parts.length === 1) return parts;
  if (root !== undefined && parts.length === 2 && piWebConfigNamespaceFields(root)?.includes(parts[1] ?? "") === true) return parts;
  if (root === "plugins" && parts[1] !== "" && (parts.length === 2 || (parts.length === 3 && ["enabled", "settings"].includes(parts[2] ?? "")) || (parts.length === 4 && parts[2] === "settings"))) return parts;
  return fail(`not an independently resettable setting: ${pointer}`);
}

export const configUpdateTargets = piWebConfigSettingPointers;

export function overlappingConfigPointers(left: string, right: string): boolean {
  return left === right || left.startsWith(right + "/") || right.startsWith(left + "/");
}

export function validateConfigUpdate(update: PiWebConfigUpdate, enforced: Readonly<Record<string, string>> = {}): void {
  const targets = configUpdateTargets(update.set ?? {});
  const unset = update.unset ?? [];
  for (const pointer of unset) parseConfigPointer(pointer);
  for (let index = 0; index < unset.length; index += 1) {
    const pointer = unset[index];
    if (pointer === undefined) continue;
    if (targets.some((target) => overlappingConfigPointers(target, pointer)) || unset.slice(0, index).some((target) => overlappingConfigPointers(target, pointer))) fail(`conflicting set/unset targets: ${pointer}`);
  }
  for (const target of [...targets, ...unset]) {
    const policy = Object.entries(enforced).find(([pointer]) => overlappingConfigPointers(pointer, target));
    if (policy !== undefined) fail(`${target} is enforced by ${policy[1]}`);
  }
}

/** Legacy replacement may omit locked settings, but must not change hidden saved overrides. */
export function preserveEnforcedConfigOverrides(current: PiWebConfigValues, replacement: PiWebConfigValues, enforced: Readonly<Record<string, string>> = {}): PiWebConfigValues {
  const result: Record<string, unknown> = structuredClone({ ...replacement });
  for (const [pointer, source] of Object.entries(enforced)) {
    const parts = parseConfigPointer(pointer);
    const saved = valueAt(current, parts);
    const supplied = valueAt(replacement, parts);
    if (supplied !== undefined && !isDeepStrictEqual(supplied, saved)) fail(`${pointer} is enforced by ${source}`);
    if (saved === undefined) continue;
    let record = result;
    for (const part of parts.slice(0, -1)) {
      const child = Object.hasOwn(record, part) ? record[part] : undefined;
      if (isRecord(child)) {
        record = child;
      } else {
        const envelope: Record<string, unknown> = {};
        Object.defineProperty(record, part, { value: envelope, enumerable: true, writable: true, configurable: true });
        record = envelope;
      }
    }
    const key = parts.at(-1);
    if (key !== undefined) Object.defineProperty(record, key, { value: structuredClone(saved), enumerable: true, writable: true, configurable: true });
  }
  return result;
}

function valueAt(value: unknown, parts: readonly string[]): unknown {
  for (const part of parts) {
    if (!isRecord(value) || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

/** Remove only saved overrides; prune empty namespace envelopes to restore inheritance. */
export function removeConfigOverrides(config: PiWebConfigValues, pointers: readonly string[]): PiWebConfigValues {
  const result: Record<string, unknown> = structuredClone({ ...config });
  for (const pointer of pointers) removeAt(result, parseConfigPointer(pointer));
  return result;
}

function removeAt(record: Record<string, unknown>, parts: readonly string[]): void {
  const [key, ...rest] = parts;
  if (key === undefined || !Object.hasOwn(record, key)) return;
  if (rest.length === 0) { Reflect.deleteProperty(record, key); return; }
  const child = record[key];
  if (!isRecord(child)) return;
  removeAt(child, rest);
  if (Object.keys(child).length === 0) Reflect.deleteProperty(record, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never { throw new Error(`PI WEB config update ${message}`); }

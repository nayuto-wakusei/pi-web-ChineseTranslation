import type { Machine, MachineHealth, MachineKind, MachineRuntime, MachineStatus } from "../../../../shared/apiTypes";
import { arrayOf, optionalField, optionalString, requireBoolean, requireRecord, requireString } from "./core";
import { parsePiWebCapabilities, parsePiWebComponentStatus, parsePiWebRuntimeComponents } from "./piWeb";

export function parseMachinesResponse(value: unknown): Machine[] {
  const record = requireRecord(value);
  return arrayOf(parseMachine)(record["machines"]);
}

export function parseMachine(value: unknown): Machine {
  const record = requireRecord(value);
  const kind = requireMachineKind(record, "kind");
  const baseUrl = optionalString(record, "baseUrl");
  const status = optionalMachineStatus(record, "status");
  const statusMessage = optionalString(record, "statusMessage");
  return {
    id: requireString(record, "id"),
    name: requireString(record, "name"),
    kind,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    createdAt: requireString(record, "createdAt"),
    updatedAt: requireString(record, "updatedAt"),
    ...(status === undefined ? {} : { status }),
    ...(statusMessage === undefined ? {} : { statusMessage }),
  };
}

export function parseMachineHealth(value: unknown): MachineHealth {
  const record = requireRecord(value);
  const status = optionalMachineStatus(record, "status");
  const error = optionalString(record, "error");
  return {
    machineId: requireString(record, "machineId"),
    ok: requireBoolean(record, "ok"),
    checkedAt: requireString(record, "checkedAt"),
    ...(status === undefined ? {} : { status }),
    ...(record["web"] === undefined ? {} : { web: parsePiWebComponentStatus(record["web"]) }),
    ...(record["sessiond"] === undefined ? {} : { sessiond: parsePiWebComponentStatus(record["sessiond"]) }),
    ...(error === undefined ? {} : { error }),
  };
}

export function parseMachineRuntime(value: unknown): MachineRuntime {
  const record = requireRecord(value);
  const error = optionalString(record, "error");
  return {
    machineId: requireString(record, "machineId"),
    ok: requireBoolean(record, "ok"),
    checkedAt: requireString(record, "checkedAt"),
    ...optionalField("packageName", optionalString(record, "packageName")),
    ...optionalField("generatedAt", optionalString(record, "generatedAt")),
    ...(record["components"] === undefined ? {} : { components: parsePiWebRuntimeComponents(record["components"]) }),
    ...(record["capabilities"] === undefined ? {} : { capabilities: parsePiWebCapabilities(record["capabilities"]) }),
    ...(error === undefined ? {} : { error }),
  };
}

function requireMachineKind(record: Record<string, unknown>, key: string): MachineKind {
  const value = requireString(record, key);
  if (value !== "local" && value !== "remote") throw new Error(`Expected machine kind field: ${key}`);
  return value;
}

function optionalMachineStatus(record: Record<string, unknown>, key: string): MachineStatus | undefined {
  const value = optionalString(record, key);
  if (value === undefined) return undefined;
  if (value !== "unknown" && value !== "online" && value !== "offline" && value !== "error") throw new Error(`Expected machine status field: ${key}`);
  return value;
}

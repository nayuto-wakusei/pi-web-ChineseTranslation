import type { TerminalCommandRun } from "./apiTypes.js";

export function requireTerminalCommandRun(value: unknown, invalidCommandRun: () => Error): TerminalCommandRun {
  if (!isRecord(value)) throw invalidCommandRun();
  const status = value["status"];
  const exitCode = optionalFiniteNumber(value["exitCode"]);
  const startedAt = optionalString(value["startedAt"]);
  const completedAt = optionalString(value["completedAt"]);
  if (typeof value["id"] !== "string"
    || typeof value["origin"] !== "string"
    || typeof value["projectId"] !== "string"
    || typeof value["workspaceId"] !== "string"
    || typeof value["terminalId"] !== "string"
    || typeof value["title"] !== "string"
    || typeof value["command"] !== "string"
    || (status !== "queued" && status !== "running" && status !== "succeeded" && status !== "failed")
    || exitCode === invalidOptionalField
    || typeof value["createdAt"] !== "string"
    || startedAt === invalidOptionalField
    || completedAt === invalidOptionalField
    || !isStringRecord(value["metadata"])) {
    throw invalidCommandRun();
  }
  return {
    id: value["id"],
    origin: value["origin"],
    projectId: value["projectId"],
    workspaceId: value["workspaceId"],
    terminalId: value["terminalId"],
    title: value["title"],
    command: value["command"],
    status,
    ...(exitCode === undefined ? {} : { exitCode }),
    createdAt: value["createdAt"],
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    metadata: { ...value["metadata"] },
  };
}

const invalidOptionalField = Symbol("invalid optional Terminal field");

function optionalFiniteNumber(value: unknown): number | undefined | typeof invalidOptionalField {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : invalidOptionalField;
}

function optionalString(value: unknown): string | undefined | typeof invalidOptionalField {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : invalidOptionalField;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((child) => typeof child === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

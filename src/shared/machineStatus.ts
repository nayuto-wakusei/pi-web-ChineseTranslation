/**
 * Internal per-machine status contract shared by sessiond, the web tier, and
 * the browser. Status is attributed by sessiond, never inferred in the UI.
 */
export type StatusFlags = Readonly<Record<string, boolean>>;

export interface MachineStatusSnapshot {
  epochId: string;
  revision: number;
  machine: StatusFlags;
  projects: Readonly<Record<string, StatusFlags>>;
  workspaces: Readonly<Record<string, StatusFlags>>;
  unattributed: StatusFlags;
  generatedAt: string;
}

export interface MachineStatusUiEvent {
  type: "machine.status";
  status: MachineStatusSnapshot;
}

export const CORE_STATUS_FLAGS = {
  working: "core:working",
  terminal: "core:terminal",
  unread: "core:unread",
} as const;

export function rollUpStatusFlags(sources: Iterable<StatusFlags>): StatusFlags {
  const rolled = new Map<string, boolean>();
  for (const source of sources) {
    for (const [flagId, isSet] of Object.entries(source)) {
      if (isSet) rolled.set(flagId, true);
    }
  }
  return Object.fromEntries(rolled);
}

export function parseMachineStatusSnapshot(value: unknown): MachineStatusSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const epochId = value["epochId"];
  const revision = value["revision"];
  const generatedAt = value["generatedAt"];
  const machine = parseStatusFlags(value["machine"]);
  const unattributed = parseStatusFlags(value["unattributed"]);
  const projects = parseStatusFlagsByNodeId(value["projects"]);
  const workspaces = parseStatusFlagsByNodeId(value["workspaces"]);
  if (typeof epochId !== "string" || epochId === "") return undefined;
  if (typeof revision !== "number" || !Number.isFinite(revision)) return undefined;
  if (typeof generatedAt !== "string" || generatedAt === "") return undefined;
  if (machine === undefined || unattributed === undefined || projects === undefined || workspaces === undefined) return undefined;
  return { epochId, revision, machine, projects, workspaces, unattributed, generatedAt };
}

function parseStatusFlags(value: unknown): StatusFlags | undefined {
  if (!isRecord(value)) return undefined;
  const flags = new Map<string, boolean>();
  for (const [flagId, isSet] of Object.entries(value)) {
    if (typeof isSet === "boolean") flags.set(flagId, isSet);
  }
  return Object.fromEntries(flags);
}

function parseStatusFlagsByNodeId(value: unknown): Readonly<Record<string, StatusFlags>> | undefined {
  if (!isRecord(value)) return undefined;
  const nodes = new Map<string, StatusFlags>();
  for (const [nodeId, nodeFlags] of Object.entries(value)) {
    const parsed = parseStatusFlags(nodeFlags);
    if (parsed !== undefined) nodes.set(nodeId, parsed);
  }
  return Object.fromEntries(nodes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

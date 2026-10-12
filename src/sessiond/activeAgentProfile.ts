import { createHash } from "node:crypto";
import { isHostAbsoluteAgentDir, isSafeAgentCommandForHost, PI_CODING_AGENT_SESSION_DIR_ENV, PI_WEB_AGENT_SESSION_DIR_ENV, type EffectivePiWebAgentConfig } from "../config.js";
import type { ActiveAgentProfileDescriptor } from "../shared/apiTypes.js";
import { ACTIVE_AGENT_PROFILE_SCHEMA_VERSION } from "../shared/activeAgentProfile.js";

export interface SessionDaemonActiveAgentProfile {
  readonly schemaVersion: 1;
  readonly dir: string;
  readonly command: string;
  readonly revision: string;
  readonly sessionDirEnvKeys: readonly string[];
}

export function createActiveAgentProfileDescriptor(agent: EffectivePiWebAgentConfig): SessionDaemonActiveAgentProfile {
  if (!isSafeAgentCommandForHost(agent.command) || !isHostAbsoluteAgentDir(agent.dir)) {
    throw new Error("Active agent profile command and directory must be valid for this host");
  }
  if (!hasValidSessionDirEnvKeys(agent.sessionDirEnvKeys)) {
    throw new Error("Active agent profile session directory environment keys must use the explicit PI WEB policy");
  }
  const sessionDirEnvKeys = Object.freeze([...agent.sessionDirEnvKeys]);
  const revisionInput = JSON.stringify({
    schemaVersion: 1,
    command: agent.command,
    dir: agent.dir,
    sessionDirEnvKeys,
  });

  return Object.freeze({
    schemaVersion: 1,
    revision: `sha256:${createHash("sha256").update(revisionInput).digest("hex")}`,
    command: agent.command,
    dir: agent.dir,
    sessionDirEnvKeys,
  });
}

export function publicActiveAgentProfileDescriptor(profile: { readonly dir: string }): ActiveAgentProfileDescriptor {
  return Object.freeze({ schemaVersion: ACTIVE_AGENT_PROFILE_SCHEMA_VERSION, dir: profile.dir });
}

export function parseLegacyActiveAgentProfileDescriptor(value: unknown): SessionDaemonActiveAgentProfile | undefined {
  if (!isRecord(value)) return undefined;
  const fields = ["schemaVersion", "dir", "command", "revision", "sessionDirEnvKeys"];
  if (Object.keys(value).some((key) => !fields.includes(key))) return undefined;
  const profile = value;
  const dir = profile["dir"];
  const command = profile["command"];
  const revision = profile["revision"];
  const keys = profile["sessionDirEnvKeys"];
  if (profile["schemaVersion"] !== 1 || typeof dir !== "string" || !isHostAbsoluteAgentDir(dir)
    || typeof command !== "string" || !isSafeAgentCommandForHost(command)
    || typeof revision !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(revision)
    || !Array.isArray(keys) || !keys.every((key: unknown): key is string => typeof key === "string")
    || !hasValidSessionDirEnvKeys(keys)) return undefined;
  return Object.freeze({ schemaVersion: 1, dir, command, revision, sessionDirEnvKeys: Object.freeze([...keys]) });
}

function hasValidSessionDirEnvKeys(keys: readonly string[]): boolean {
  return (keys.length === 1 || keys.length === 2)
    && keys[0] === PI_WEB_AGENT_SESSION_DIR_ENV
    && (keys.length === 1 || keys[1] === PI_CODING_AGENT_SESSION_DIR_ENV);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

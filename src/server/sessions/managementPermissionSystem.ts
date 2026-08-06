import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ManagementEmbedContext } from "../managementEmbed.js";

export const PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR = "PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR";

const MANAGEMENT_AGENT_TOOL_NAMES = ["read", "write", "edit", "ls", "grep", "find", "python"] as const;
const ALWAYS_DENIED_TOOL_NAMES = [
  "bash",
  "shell",
  "terminal",
  "terminal-command-runs",
  "powershell",
  "pwsh",
  "mcp",
  "http",
  "webfetch",
  "websearch",
] as const;

type PermissionState = "allow" | "deny" | "ask";

interface PiPermissionSystemPolicy {
  defaultPolicy: {
    tools: PermissionState;
    bash: PermissionState;
    mcp: PermissionState;
    skills: PermissionState;
    special: PermissionState;
  };
  tools: Record<string, PermissionState>;
  bash: Record<string, PermissionState>;
  mcp: Record<string, PermissionState>;
  skills: Record<string, PermissionState>;
  special: {
    doom_loop: PermissionState;
    external_directory: PermissionState;
  };
}

export function createManagementPermissionSystemPolicy(context: ManagementEmbedContext, extraToolNames: readonly string[] = []): PiPermissionSystemPolicy {
  const tools: Record<string, PermissionState> = { "*": "deny" };
  for (const tool of managementAgentToolNames(context, extraToolNames)) tools[tool] = "allow";
  for (const tool of managementDeniedToolNames(context)) tools[tool] = "deny";

  return {
    defaultPolicy: {
      tools: "deny",
      bash: "deny",
      mcp: "deny",
      skills: "deny",
      special: "deny",
    },
    tools,
    bash: { "*": "deny" },
    mcp: { "*": "deny" },
    skills: { "*": "deny" },
    special: {
      doom_loop: "deny",
      external_directory: "deny",
    },
  };
}

export function managementAgentToolNames(context: ManagementEmbedContext, extraToolNames: readonly string[] = []): string[] {
  const denied = new Set([...ALWAYS_DENIED_TOOL_NAMES, ...(context.tools?.deny ?? [])]);
  const safeTools = MANAGEMENT_AGENT_TOOL_NAMES.filter((tool) => !denied.has(tool));
  const allowed = context.tools?.allow;
  const selected = allowed === undefined || allowed.length === 0 ? [...safeTools] : safeTools.filter((tool) => allowed.includes(tool));
  const selectedNames = new Set<string>(selected);
  return [...selected, ...extraToolNames.filter((tool) => !denied.has(tool) && !selectedNames.has(tool))];
}

export async function writeManagementPermissionSystemPolicy(agentDir: string, cwd: string, context: ManagementEmbedContext, extraToolNames: readonly string[] = []): Promise<string> {
  const policyAgentDir = join(
    agentDir,
    "management-embed",
    "permission-system",
    safePathSegment(context.user.rootUserId),
    createHash("sha256").update(cwd).digest("hex").slice(0, 16),
  );
  await mkdir(policyAgentDir, { recursive: true });
  await writeFile(join(policyAgentDir, "pi-permissions.jsonc"), `${JSON.stringify(createManagementPermissionSystemPolicy(context, extraToolNames), null, 2)}\n`, "utf8");
  return policyAgentDir;
}

let runtimeEnvironmentQueue = Promise.resolve();

export async function withRuntimeCreationEnvironment<T>(env: Record<string, string | undefined>, action: () => Promise<T>): Promise<T> {
  const previousQueue = runtimeEnvironmentQueue;
  let releaseQueue: () => void = () => undefined;
  runtimeEnvironmentQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previousQueue;

  const previousValues = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }

  try {
    return await action();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    releaseQueue();
  }
}

function managementDeniedToolNames(context: ManagementEmbedContext): string[] {
  return [...ALWAYS_DENIED_TOOL_NAMES, ...(context.tools?.deny ?? [])];
}

function safePathSegment(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return safe === "" ? "user" : safe.slice(0, 80);
}

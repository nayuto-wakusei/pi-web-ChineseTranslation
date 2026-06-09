import type { ManagementEmbedContext } from "../managementEmbed.js";

const DEFAULT_PATH = "/usr/local/bin:/usr/bin:/bin";
const SAFE_HOST_ENV_KEYS = ["PATH", "LANG", "LC_ALL", "LC_CTYPE"] as const;
const SENSITIVE_ENV_PATTERNS = ["TOKEN", "SECRET", "PASSWORD", "PRIVATE_KEY", "API_KEY"] as const;
const SANDBOX_WORKSPACE = "/workspace";
const SANDBOX_HOME = "/tmp/pi-web-home";

export const DEFAULT_BUBBLEWRAP_PATHS = [
  "/usr",
  "/bin",
  "/lib",
  "/lib64",
  "/etc/alternatives",
  "/etc/ld.so.cache",
  "/etc/ssl",
  "/etc/ca-certificates",
] as const;

export interface ManagedSandboxEnvironmentOptions {
  hostEnv: NodeJS.ProcessEnv;
  context: Pick<ManagementEmbedContext, "sandbox">;
}

export interface BubblewrapPythonInvocationOptions {
  bubblewrapExecutable: string;
  pythonExecutable: string;
  workspaceRoot: string;
  env?: NodeJS.ProcessEnv;
  readOnlyPaths?: readonly string[];
}

export interface BubblewrapPythonInvocation {
  command: string;
  args: string[];
}

export function createManagedSandboxEnvironment(options: ManagedSandboxEnvironmentOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_HOST_ENV_KEYS) {
    const value = options.hostEnv[key];
    if (value !== undefined && value !== "") env[key] = value;
  }
  env["PATH"] ??= DEFAULT_PATH;

  for (const [key, value] of Object.entries(options.context.sandbox?.env ?? {})) {
    assertNonSensitiveSandboxEnvKey(key);
    env[key] = value;
  }

  env["HOME"] = SANDBOX_HOME;
  env["TMPDIR"] = "/tmp";
  return env;
}

export function createBubblewrapPythonInvocation(options: BubblewrapPythonInvocationOptions): BubblewrapPythonInvocation {
  const args = [
    "--unshare-net",
    "--unshare-ipc",
    "--unshare-pid",
    "--die-with-parent",
    "--clearenv",
    ...Object.entries(options.env ?? {}).flatMap(([key, value]) => ["--setenv", key, value ?? ""]),
    "--tmpfs",
    "/tmp",
    "--dir",
    SANDBOX_HOME,
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    ...[...new Set(options.readOnlyPaths ?? DEFAULT_BUBBLEWRAP_PATHS)].flatMap((path) => ["--ro-bind", path, path]),
    "--bind",
    options.workspaceRoot,
    SANDBOX_WORKSPACE,
    "--chdir",
    SANDBOX_WORKSPACE,
    options.pythonExecutable,
    "-I",
    "-",
  ];
  return { command: options.bubblewrapExecutable, args };
}

function assertNonSensitiveSandboxEnvKey(key: string): void {
  const upper = key.toUpperCase();
  if (SENSITIVE_ENV_PATTERNS.some((pattern) => upper.includes(pattern))) {
    throw new Error(`Sensitive sandbox environment variable is not allowed: ${key}`);
  }
}

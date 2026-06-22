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

export interface BubblewrapShellInvocationOptions {
  bubblewrapExecutable: string;
  shellExecutable: string;
  workspaceRoot: string;
  script: string;
  env?: NodeJS.ProcessEnv;
  readOnlyPaths?: readonly string[];
}

export interface BubblewrapShellInvocation {
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
    ...[...new Set(options.readOnlyPaths ?? DEFAULT_BUBBLEWRAP_PATHS)].flatMap((path) => ["--ro-bind-try", path, path]),
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

export function createBubblewrapShellInvocation(options: BubblewrapShellInvocationOptions): BubblewrapShellInvocation {
  const args = [
    ...bubblewrapBaseArgs(options.env, options.readOnlyPaths),
    "--bind",
    options.workspaceRoot,
    SANDBOX_WORKSPACE,
    "--chdir",
    SANDBOX_WORKSPACE,
    options.shellExecutable,
    "-lc",
    options.script,
  ];
  return { command: options.bubblewrapExecutable, args };
}

function bubblewrapBaseArgs(env: NodeJS.ProcessEnv | undefined, readOnlyPaths: readonly string[] | undefined): string[] {
  return [
    "--unshare-net",
    "--unshare-ipc",
    "--unshare-pid",
    "--die-with-parent",
    "--clearenv",
    ...Object.entries(env ?? {}).flatMap(([key, value]) => ["--setenv", key, value ?? ""]),
    "--tmpfs",
    "/tmp",
    "--dir",
    SANDBOX_HOME,
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    ...[...new Set(readOnlyPaths ?? DEFAULT_BUBBLEWRAP_PATHS)].flatMap((path) => ["--ro-bind-try", path, path]),
  ];
}

export function bubblewrapUnavailableReason(output: string): string | undefined {
  if (output.includes("setting up uid map: Permission denied")) return "setting up uid map: Permission denied";
  if (output.includes("Failed RTM_NEWADDR: Operation not permitted")) return "Failed RTM_NEWADDR: Operation not permitted";
  if (output.includes("No permissions to creating new namespace")) return "No permissions to creating new namespace";
  if (output.includes("Creating new namespace failed")) return "Creating new namespace failed";
  return undefined;
}

export function createManagedPythonFallbackPrelude(root: string): string {
  return `
import builtins
import io
import os
import pathlib
import subprocess

_PI_WEB_ROOT = ${JSON.stringify(root)}
_PI_WEB_OPEN = builtins.open
_PI_WEB_IO_OPEN = io.open
_PI_WEB_PATH_OPEN = pathlib.Path.open
_PI_WEB_PATH_READ_TEXT = pathlib.Path.read_text
_PI_WEB_PATH_READ_BYTES = pathlib.Path.read_bytes
_PI_WEB_PATH_WRITE_TEXT = pathlib.Path.write_text
_PI_WEB_PATH_WRITE_BYTES = pathlib.Path.write_bytes

def _pi_web_inside(path):
    real = os.path.realpath(os.fspath(path))
    rel = os.path.relpath(real, _PI_WEB_ROOT)
    return rel == "." or (not rel.startswith("..") and not os.path.isabs(rel))

def _pi_web_check_path(path):
    if not isinstance(path, (str, bytes, os.PathLike)):
        return
    if not _pi_web_inside(path):
        raise PermissionError("path outside the managed project sandbox: %s" % path)

def open(file, mode="r", *args, **kwargs):
    _pi_web_check_path(file)
    return _PI_WEB_OPEN(file, mode, *args, **kwargs)

def _pi_web_path_open(self, *args, **kwargs):
    _pi_web_check_path(self)
    return _PI_WEB_PATH_OPEN(self, *args, **kwargs)

def _pi_web_path_read_text(self, *args, **kwargs):
    _pi_web_check_path(self)
    return _PI_WEB_PATH_READ_TEXT(self, *args, **kwargs)

def _pi_web_path_read_bytes(self, *args, **kwargs):
    _pi_web_check_path(self)
    return _PI_WEB_PATH_READ_BYTES(self, *args, **kwargs)

def _pi_web_path_write_text(self, *args, **kwargs):
    _pi_web_check_path(self)
    return _PI_WEB_PATH_WRITE_TEXT(self, *args, **kwargs)

def _pi_web_path_write_bytes(self, *args, **kwargs):
    _pi_web_check_path(self)
    return _PI_WEB_PATH_WRITE_BYTES(self, *args, **kwargs)

def _pi_web_blocked_os_path(path, *args, **kwargs):
    _pi_web_check_path(path)
    raise PermissionError("low-level os path APIs are disabled in managed Python fallback mode")

def _pi_web_blocked_process(*args, **kwargs):
    raise PermissionError("subprocess and shell execution are disabled in managed Python fallback mode")

builtins.open = open
io.open = open
pathlib.Path.open = _pi_web_path_open
pathlib.Path.read_text = _pi_web_path_read_text
pathlib.Path.read_bytes = _pi_web_path_read_bytes
pathlib.Path.write_text = _pi_web_path_write_text
pathlib.Path.write_bytes = _pi_web_path_write_bytes
os.open = _pi_web_blocked_os_path
os.listdir = _pi_web_blocked_os_path
os.scandir = _pi_web_blocked_os_path
os.stat = _pi_web_blocked_os_path
os.lstat = _pi_web_blocked_os_path
subprocess.Popen = _pi_web_blocked_process
subprocess.run = _pi_web_blocked_process
subprocess.call = _pi_web_blocked_process
subprocess.check_call = _pi_web_blocked_process
subprocess.check_output = _pi_web_blocked_process
os.system = _pi_web_blocked_process
`;
}

function assertNonSensitiveSandboxEnvKey(key: string): void {
  const upper = key.toUpperCase();
  if (SENSITIVE_ENV_PATTERNS.some((pattern) => upper.includes(pattern))) {
    throw new Error(`Sensitive sandbox environment variable is not allowed: ${key}`);
  }
}

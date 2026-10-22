import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { getAgentDir, VERSION, type LoadedMcpConfig, type McpExtensionOptions } from "../../piSdk.js";
import { piRuntimePackageInfo } from "../../piRuntime.js";

type McpCredentials = NonNullable<McpExtensionOptions["credentials"]>;
interface CredentialModule {
  McpOAuthCredentialStore: new (backend: object, lockDir: string) => McpCredentials;
}
interface BackendModule {
  FileAuthStorageBackend: new (path: string) => object;
}
interface ConfigModule {
  loadMcpConfig(options: { agentDir: string; cwd: string; projectTrusted: boolean }): LoadedMcpConfig;
}

interface AdapterDependencies {
  packageInfo?: typeof piRuntimePackageInfo;
  sdkVersion?: string;
  importModule?: (url: string) => Promise<unknown>;
}

export interface ScopedMcpOptions {
  directory: string;
  /** Management uses a private config root; normal mode keeps Pi's original config discovery. */
  configAgentDir?: string;
}

export function mcpOAuthStorageDirectory(projectScopeDirectory: string, managementScope?: string): string {
  const root = join(projectScopeDirectory, "mcp");
  return managementScope === undefined ? root : join(root, "identities", createHash("sha256").update(managementScope).digest("hex"));
}

/**
 * Pi 1.3.0 exposes credential injection but not its constructor. These three
 * version-pinned internal modules must come from the same selected host SDK.
 */
export async function createMcpOAuthCredentialOptions(
  options: ScopedMcpOptions,
  dependencies: AdapterDependencies = {},
): Promise<Pick<McpExtensionOptions, "credentials" | "logPath" | "loadConfig">> {
  const info = await (dependencies.packageInfo ?? piRuntimePackageInfo)();
  if (info.version !== "1.3.0" || (dependencies.sdkVersion ?? VERSION) !== info.version) {
    throw new Error("Scoped MCP authentication requires the selected Pi SDK version 1.3.0 with a matching package identity");
  }
  const importModule = dependencies.importModule ?? ((url: string): Promise<unknown> => import(url));
  const modules = await Promise.all([
    loadInternal(info.directory, "dist/extensions/mcp/oauth.js", importModule),
    loadInternal(info.directory, "dist/core/auth-storage.js", importModule),
    loadInternal(info.directory, "dist/extensions/mcp/config.js", importModule),
  ]);
  const [credentials, backend, config] = modules;
  if (!isCredentialModule(credentials) || !isBackendModule(backend) || !isConfigModule(config)) {
    throw new Error("The selected Pi 1.3.0 SDK does not expose the expected MCP credential adapter contracts");
  }
  const directory = resolve(options.directory);
  const lockDir = join(directory, "refresh-locks");
  await privateDirectory(directory);
  await privateDirectory(lockDir);
  const authPath = join(directory, "mcp-auth.json");
  const logPath = join(directory, "mcp.log");
  await privateFileIfPresent(authPath);
  await privateFileIfPresent(logPath);
  const store = new credentials.McpOAuthCredentialStore(new backend.FileAuthStorageBackend(authPath), lockDir);
  const configAgentDir = options.configAgentDir ?? getAgentDir();
  return {
    credentials: store,
    logPath,
    loadConfig: (ctx) => config.loadMcpConfig({ agentDir: configAgentDir, cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() }),
  };
}

async function loadInternal(root: string, file: string, importModule: (url: string) => Promise<unknown>): Promise<unknown> {
  const canonicalRoot = await realpath(root);
  const path = await realpath(join(root, file));
  const child = relative(canonicalRoot, path);
  if (isAbsolute(child) || child === ".." || child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("The MCP credential adapter module is outside the selected Pi SDK");
  }
  return importModule(pathToFileURL(path).href);
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("MCP private storage must be a directory, not a symbolic link");
  await chmod(path, 0o700);
}

async function privateFileIfPresent(path: string): Promise<void> {
  let entry;
  try { entry = await lstat(path); }
  catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("MCP private storage must be a regular file");
  await chmod(path, 0o600);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function hasConstructor(value: unknown, methods: string[]): boolean {
  if (typeof value !== "function" || !("prototype" in value)) return false;
  const prototype: unknown = value.prototype;
  return isRecord(prototype) && methods.every((method) => typeof prototype[method] === "function");
}
function isCredentialModule(value: unknown): value is CredentialModule {
  return isRecord(value) && hasConstructor(value["McpOAuthCredentialStore"], ["forServer", "tokens", "remove"]);
}
function isBackendModule(value: unknown): value is BackendModule {
  return isRecord(value) && hasConstructor(value["FileAuthStorageBackend"], ["withLock", "withLockAsync"]);
}
function isConfigModule(value: unknown): value is ConfigModule {
  return isRecord(value) && typeof value["loadMcpConfig"] === "function";
}

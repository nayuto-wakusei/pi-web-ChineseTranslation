import { constants } from "node:fs";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { projectAuthStoragePaths } from "./projectAuthService.js";

/**
 * Session preference scope for Pi `settings.json` (default thinking level,
 * default model, etc.). Auth/models stay on their own stores; this only owns
 * SettingsManager global-settings path so normal and management embed do not
 * share defaults across modes or projects.
 */
export type SessionSettingsMode = "normal" | "management";

/**
 * Directory that owns the scoped `settings.json` for a registered project.
 * Normal mode co-locates with project auth/models under `projects/<hash>/`.
 * Management embed uses a parallel tree under `management-embed/projects/<hash>/`.
 */
export function projectSettingsScopeDirectory(dataDir: string, projectPath: string, mode: SessionSettingsMode): string {
  if (mode === "normal") return projectAuthStoragePaths(dataDir, projectPath).directory;
  const projectKey = projectPathKey(projectPath);
  return join(resolve(dataDir), "management-embed", "projects", projectKey);
}

/**
 * Fallback when management embed cannot resolve cwd to exactly one registered
 * project. Keeps preferences out of the shared global agentDir.
 */
export function managementOrphanSettingsDirectory(dataDir: string, cwd: string): string {
  const cwdKey = projectPathKey(cwd);
  return join(resolve(dataDir), "management-embed", "orphan", cwdKey);
}

/**
 * Ensure `scopeDirectory/settings.json` exists. On first use, copy the global
 * agent settings once (same bootstrap contract as project auth files). Existing
 * scoped files are never overwritten.
 */
export async function ensureScopedSettingsBootstrapped(scopeDirectory: string, globalAgentDir: string): Promise<string> {
  await mkdir(scopeDirectory, { recursive: true, mode: 0o700 });
  const settingsPath = join(scopeDirectory, "settings.json");
  await ensureCopiedOrCreated(settingsPath, join(resolve(globalAgentDir), "settings.json"), "{}\n");
  return settingsPath;
}

/**
 * Build a SettingsManager whose global settings file lives in `scopeDirectory`,
 * while callers keep using the real agentDir for packages/skills resources.
 */
export async function createScopedSettingsManager(options: {
  cwd: string;
  scopeDirectory: string;
  globalAgentDir: string;
}): Promise<SettingsManager> {
  await ensureScopedSettingsBootstrapped(options.scopeDirectory, options.globalAgentDir);
  return SettingsManager.create(options.cwd, options.scopeDirectory);
}

export function projectPathKey(projectPath: string): string {
  return createHash("sha256").update(normalizeProjectPath(projectPath), "utf8").digest("hex");
}

/**
 * Resolve the settings scope directory for a session cwd.
 * - Registered project: mode × project directory.
 * - Management without a unique project: orphan scope for that cwd.
 * - Normal mode without a project: caller should not reach here (sessions
 *   already require a registered project for auth); orphan is not used.
 */
export function resolveSettingsScopeDirectory(options: {
  dataDir: string;
  cwd: string;
  mode: SessionSettingsMode;
  projectPath?: string;
}): string {
  if (options.projectPath !== undefined) {
    return projectSettingsScopeDirectory(options.dataDir, options.projectPath, options.mode);
  }
  if (options.mode === "management") {
    return managementOrphanSettingsDirectory(options.dataDir, options.cwd);
  }
  // Fallback for tests / misconfiguration: keep preferences out of the shared
  // global agent dir by using an orphan-like path under projects/_unscoped/.
  return join(resolve(options.dataDir), "projects", "_unscoped", projectPathKey(options.cwd));
}

function normalizeProjectPath(projectPath: string): string {
  const normalized = resolve(projectPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function ensureCopiedOrCreated(destination: string, source: string, fallback: string): Promise<void> {
  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await chmod(destination, 0o600);
    return;
  } catch (error) {
    if (!isNodeError(error, "EEXIST") && !isNodeError(error, "ENOENT")) throw error;
  }

  try {
    await writeFile(destination, fallback, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

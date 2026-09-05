import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { CONFIG_DIR_NAME, SettingsManager } from "@earendil-works/pi-coding-agent";
import { projectAuthStoragePaths } from "./projectAuthService.js";

/**
 * Session preference scope for a small set of Pi global defaults (thinking level
 * and default model selection). Normal mode also scopes enabledModels because
 * each project owns a separate model registry. Packages, extensions, proxy, and
 * other shared agent settings keep reading and writing the real agentDir
 * settings.json. Management mode does not expose enabledModels.
 */
export type SessionSettingsMode = "normal" | "management";

/** Preference keys isolated per mode x project. Everything else stays shared. */
export const SESSION_PREFERENCE_KEYS = [
  "defaultThinkingLevel",
  "defaultProvider",
  "defaultModel",
] as const;

const SESSION_PREFERENCE_KEY_SET = new Set<string>(SESSION_PREFERENCE_KEYS);
const NORMAL_PROJECT_SETTING_KEYS = [...SESSION_PREFERENCE_KEYS, "enabledModels"] as const;
const NORMAL_PROJECT_SETTING_KEY_SET = new Set<string>(NORMAL_PROJECT_SETTING_KEYS);
const SHARED_HIDDEN_SETTING_KEYS = new Set<string>(["enabledModels"]);

/**
 * Directory that owns preference overrides for a registered project.
 * Normal mode co-locates with project auth/models under projects/<hash>/.
 * Management embed uses a parallel tree under management-embed/projects/<hash>/.
 */
export function projectSettingsScopeDirectory(dataDir: string, projectPath: string, mode: SessionSettingsMode): string {
  if (mode === "normal") return projectAuthStoragePaths(dataDir, projectPath).directory;
  const projectKey = projectPathKey(projectPath);
  return join(resolve(dataDir), "management-embed", "projects", projectKey);
}

/**
 * Fallback when management embed cannot resolve cwd to exactly one registered
 * project. Keeps preference overrides out of the shared global agentDir.
 */
export function managementOrphanSettingsDirectory(dataDir: string, cwd: string): string {
  const cwdKey = projectPathKey(cwd);
  return join(resolve(dataDir), "management-embed", "orphan", cwdKey);
}

/** Path of the mode x project preference override file. */
export function preferencesFilePath(scopeDirectory: string): string {
  return join(resolve(scopeDirectory), "settings.preferences.json");
}

/**
 * Legacy whole-file snapshot path from the first settings-isolation attempt.
 * Only preference keys are migrated out of it; packages and other shared keys
 * are ignored so stale copies cannot freeze agent-dir configuration.
 */
export function legacyScopedSettingsFilePath(scopeDirectory: string): string {
  return join(resolve(scopeDirectory), "settings.json");
}

/**
 * Build a SettingsManager that reads shared global settings from the real
 * agentDir, overlays mode x project preference keys, and splits writes the same
 * way. Project-local .pi/settings.json keeps upstream semantics.
 */
export type ScopedSettingsManager = SettingsManager & {
  readonly piWebScopeKey: string;
  readonly piWebModelScopeEditable: boolean;
};

export async function createScopedSettingsManager(options: {
  cwd: string;
  scopeDirectory: string;
  globalAgentDir: string;
  mode: SessionSettingsMode;
}): Promise<ScopedSettingsManager> {
  await mkdir(options.scopeDirectory, { recursive: true, mode: 0o700 });
  migrateLegacyPreferenceOverrides(options.scopeDirectory, options.mode);
  return Object.assign(SettingsManager.fromStorage(new PreferenceOverrideSettingsStorage({
    cwd: options.cwd,
    globalAgentDir: options.globalAgentDir,
    scopeDirectory: options.scopeDirectory,
    mode: options.mode,
  })), {
    piWebScopeKey: resolve(options.scopeDirectory),
    piWebModelScopeEditable: options.mode === "normal",
  });
}

export function projectPathKey(projectPath: string): string {
  return createHash("sha256").update(normalizeProjectPath(projectPath), "utf8").digest("hex");
}

/**
 * Resolve the preference-override directory for a session cwd.
 * - Registered project: mode x project directory.
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

/**
 * SettingsStorage that implements read/write splitting for session preferences.
 * Tests exercise it through createScopedSettingsManager.
 */
class PreferenceOverrideSettingsStorage {
  private readonly projectSettingsPath: string;
  private readonly agentSettingsPath: string;
  private readonly preferencesPath: string;
  private readonly scopeDirectory: string;
  private readonly mode: SessionSettingsMode;

  constructor(options: { cwd: string; globalAgentDir: string; scopeDirectory: string; mode: SessionSettingsMode }) {
    this.projectSettingsPath = join(resolve(options.cwd), CONFIG_DIR_NAME, "settings.json");
    this.agentSettingsPath = join(resolve(options.globalAgentDir), "settings.json");
    this.scopeDirectory = resolve(options.scopeDirectory);
    this.preferencesPath = preferencesFilePath(this.scopeDirectory);
    this.mode = options.mode;
  }

  withLock(scope: "global" | "project", fn: (current: string | undefined) => string | undefined): void {
    if (scope === "project") {
      if (this.mode === "management") {
        this.withManagementFileLock(this.projectSettingsPath, fn);
      } else {
        this.withFileLock(this.projectSettingsPath, fn);
      }
      return;
    }

    const agentRaw = readTextFileIfExists(this.agentSettingsPath);
    const preferences = readPreferenceOverrides(this.scopeDirectory, this.mode);
    let current: string | undefined;
    if (agentRaw === undefined && Object.keys(preferences).length === 0) {
      current = undefined;
    } else {
      try {
        const agentSettings = agentRaw === undefined ? {} : parseSettingsObject(agentRaw);
        current = `${JSON.stringify({ ...settingsVisibleToSession(agentSettings), ...preferences }, null, 2)}\n`;
      } catch {
        // Preserve parse errors for SettingsManager when the real agent file is invalid.
        current = agentRaw;
      }
    }

    const next = fn(current);
    if (next === undefined) return;

    const nextSettings = parseSettingsObject(next);
    let agentSettings: Record<string, unknown> = {};
    let agentSettingsParseFailed = false;
    if (agentRaw !== undefined) {
      try {
        agentSettings = parseSettingsObject(agentRaw);
      } catch {
        agentSettingsParseFailed = true;
        agentSettings = {};
      }
    }

    // SettingsManager persists the full effective object. Only keep preference
    // keys that actually diverge from the real agent baseline so unrelated
    // writes cannot pin shared defaults into the override file.
    const nextPreferences = preferenceOverridesAgainstBaseline(
      pickScopedOverrides(nextSettings, this.mode),
      pickSettings(agentSettings, SESSION_PREFERENCE_KEYS),
      this.mode,
    );
    const existingPreferences = readPreferenceOverrides(this.scopeDirectory, this.mode);
    if (!stableJsonEqual(existingPreferences, nextPreferences)) {
      writeJsonFile(this.preferencesPath, nextPreferences);
    }

    const nextSharedSettings = settingsVisibleToSession(omitScopedKeys(nextSettings, this.mode));
    // Invalid agent settings are left for SettingsManager diagnostics on read.
    // Avoid clobbering a corrupt file during a preference-only write.
    if (agentSettingsParseFailed && Object.keys(nextSharedSettings).length === 0) return;

    const existingSharedSettings = settingsVisibleToSession(omitScopedKeys(agentSettings, this.mode));
    // Only rewrite the shared agent file when a non-preference key actually changed.
    if (stableJsonEqual(existingSharedSettings, nextSharedSettings)) return;
    writeJsonFile(this.agentSettingsPath, {
      ...pickSettings(agentSettings, SESSION_PREFERENCE_KEYS),
      ...pickSettings(agentSettings, SHARED_HIDDEN_SETTING_KEYS),
      ...nextSharedSettings,
    });
  }

  private withManagementFileLock(path: string, fn: (current: string | undefined) => string | undefined): void {
    const storedRaw = readTextFileIfExists(path);
    let storedSettings: Record<string, unknown> = {};
    let current = storedRaw;
    if (storedRaw !== undefined) {
      try {
        storedSettings = parseSettingsObject(storedRaw);
        current = `${JSON.stringify(settingsVisibleToSession(storedSettings), null, 2)}\n`;
      } catch {
        // Preserve parse errors for SettingsManager instead of masking an invalid file.
      }
    }

    const next = fn(current);
    if (next === undefined) return;
    const nextSettings = parseSettingsObject(next);
    writeJsonFile(path, {
      ...pickSettings(storedSettings, SHARED_HIDDEN_SETTING_KEYS),
      ...settingsVisibleToSession(nextSettings),
    });
  }

  private withFileLock(path: string, fn: (current: string | undefined) => string | undefined): void {
    const current = readTextFileIfExists(path);
    const next = fn(current);
    if (next === undefined) return;
    writeTextFile(path, next.endsWith("\n") ? next : `${next}\n`);
  }
}

export function migrateLegacyPreferenceOverrides(scopeDirectory: string, mode: SessionSettingsMode): Record<string, unknown> {
  const preferencesPath = preferencesFilePath(scopeDirectory);
  if (existsSync(preferencesPath)) {
    return readPreferenceOverridesFromPath(preferencesPath, mode);
  }

  const legacyPath = legacyScopedSettingsFilePath(scopeDirectory);
  const legacyRaw = readTextFileIfExists(legacyPath);
  if (legacyRaw === undefined) return {};

  let legacySettings: Record<string, unknown>;
  try {
    legacySettings = parseSettingsObject(legacyRaw);
  } catch {
    return {};
  }

  const migrated = pickScopedOverrides(legacySettings, mode);
  if (Object.keys(migrated).length > 0) {
    writeJsonFile(preferencesPath, migrated);
  }
  return migrated;
}

function readPreferenceOverrides(scopeDirectory: string, mode: SessionSettingsMode): Record<string, unknown> {
  const preferencesPath = preferencesFilePath(scopeDirectory);
  if (existsSync(preferencesPath)) {
    return readPreferenceOverridesFromPath(preferencesPath, mode);
  }
  return migrateLegacyPreferenceOverrides(scopeDirectory, mode);
}

function readPreferenceOverridesFromPath(preferencesPath: string, mode: SessionSettingsMode): Record<string, unknown> {
  const raw = readTextFileIfExists(preferencesPath);
  if (raw === undefined) return {};
  try {
    return pickScopedOverrides(parseSettingsObject(raw), mode);
  } catch {
    return {};
  }
}

function pickSettings(settings: Record<string, unknown>, keys: Iterable<string>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(settings, key) && settings[key] !== undefined) {
      picked[key] = settings[key];
    }
  }
  return picked;
}

function pickScopedOverrides(settings: Record<string, unknown>, mode: SessionSettingsMode): Record<string, unknown> {
  return pickSettings(settings, mode === "management" ? SESSION_PREFERENCE_KEYS : NORMAL_PROJECT_SETTING_KEYS);
}

function preferenceOverridesAgainstBaseline(
  nextPreferences: Record<string, unknown>,
  agentPreferences: Record<string, unknown>,
  mode: SessionSettingsMode,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const keys = mode === "normal" ? NORMAL_PROJECT_SETTING_KEYS : SESSION_PREFERENCE_KEYS;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(nextPreferences, key)) continue;
    if (Object.prototype.hasOwnProperty.call(agentPreferences, key) && JSON.stringify(agentPreferences[key]) === JSON.stringify(nextPreferences[key])) {
      continue;
    }
    overrides[key] = nextPreferences[key];
  }
  return overrides;
}

function stableJsonEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function omitScopedKeys(settings: Record<string, unknown>, mode: SessionSettingsMode): Record<string, unknown> {
  const omitted: Record<string, unknown> = {};
  const scopedKeys = mode === "normal" ? NORMAL_PROJECT_SETTING_KEY_SET : SESSION_PREFERENCE_KEY_SET;
  for (const [key, value] of Object.entries(settings)) {
    if (scopedKeys.has(key) || value === undefined) continue;
    omitted[key] = value;
  }
  return omitted;
}

function settingsVisibleToSession(settings: Record<string, unknown>): Record<string, unknown> {
  const visible: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!SHARED_HIDDEN_SETTING_KEYS.has(key)) visible[key] = value;
  }
  return visible;
}

function parseSettingsObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isJsonObject(parsed)) throw new Error("Expected settings object");
  return parsed;
}

function readTextFileIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

function writeJsonFile(path: string, value: Record<string, unknown>): void {
  writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Keep the temp file beside the destination so rename stays atomic on the same volume.
  const adjacentTemporaryPath = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`;
  writeFileSync(adjacentTemporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(adjacentTemporaryPath, path);
}

function normalizeProjectPath(projectPath: string): string {
  const normalized = resolve(projectPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

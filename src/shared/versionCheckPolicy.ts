import { parsePiWebEnvBoolean } from "./configResolution.js";

/** Validate every alias, even when a preceding switch already disables checks. */
export function versionChecksDisabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const values = ["PI_WEB_SKIP_VERSION_CHECK", "PI_WEB_OFFLINE", "PI_SKIP_VERSION_CHECK", "PI_OFFLINE"].map((key) => {
    const value = env[key];
    return value === undefined ? false : parsePiWebEnvBoolean(value, key);
  });
  return values.some(Boolean);
}

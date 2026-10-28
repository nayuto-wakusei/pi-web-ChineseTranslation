export const DEFAULT_INSTALLATION_NAME = "PI-WEB";

/** Empty names clear the configured identity and use the product default. */
export function requireInstallationName(value: unknown, label = "PI WEB config installationName"): string {
  if (typeof value !== "string" || value.length > 120 || hasControlCharacter(value)) {
    throw new Error(`${label} must be a string of at most 120 characters without control characters`);
  }
  return value.trim();
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function installationDisplayName(name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed === undefined || trimmed === "" ? DEFAULT_INSTALLATION_NAME : trimmed;
}

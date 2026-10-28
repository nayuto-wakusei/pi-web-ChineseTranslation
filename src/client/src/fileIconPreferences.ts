export const DEFAULT_FILE_ICON_THEME_ID = "themes:material";
/** Explicit opt-out; absence of a preference means the built-in default. */
export const NO_FILE_ICONS = "none";
export const FILE_ICON_STORAGE_KEY = "pi-web-file-icon-theme";

export function readStoredFileIconPreference(): string | undefined {
  try {
    const value = window.localStorage.getItem(FILE_ICON_STORAGE_KEY);
    if (value === null) return undefined;
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "string" && parsed.length > 0) return parsed;
    console.warn("Ignoring invalid browser file icon preference");
  } catch (error) {
    console.warn("Could not read browser file icon preference", error);
  }
  return undefined;
}

export function writeStoredFileIconPreference(preference: string | undefined): void {
  try {
    if (preference === undefined) window.localStorage.removeItem(FILE_ICON_STORAGE_KEY);
    else window.localStorage.setItem(FILE_ICON_STORAGE_KEY, JSON.stringify(preference));
  } catch (error) {
    console.warn("Could not save browser file icon preference; applying to this tab only", error);
  }
}

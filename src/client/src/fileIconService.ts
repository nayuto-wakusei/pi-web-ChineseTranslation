import type { FileIconsCapability, PluginCapability } from "../../plugin-api";
import type { QualifiedFileIconThemeContribution, ThemeColorScheme } from "./plugins/types";
import { resolveFileIcon } from "./plugins/fileIcons";
import { DEFAULT_FILE_ICON_THEME_ID, NO_FILE_ICONS } from "./fileIconPreferences";

export const fileIconsCapabilityToken: PluginCapability<FileIconsCapability> = {
  pluginId: "pi-web", id: "file-icons", version: 1,
  parse(value) {
    if (!isFileIconsCapability(value)) throw new Error("File icons capability v1 is unavailable");
    return value;
  },
};

function isFileIconsCapability(value: unknown): value is FileIconsCapability {
  return typeof value === "object" && value !== null
    && "resolveIcon" in value && typeof value.resolveIcon === "function"
    && "subscribe" in value && typeof value.subscribe === "function";
}

/** App-owned live gateway view, independent of the selected machine and workspace. */
export class FileIconService {
  private themes: readonly QualifiedFileIconThemeContribution[] = [];
  private preference: string | undefined;
  private colorScheme: ThemeColorScheme = "dark";
  private readonly listeners = new Set<() => void>();
  readonly capability: FileIconsCapability = Object.freeze({
    resolveIcon: (path: string): string | undefined => {
      if (this.preference === NO_FILE_ICONS) return undefined;
      const theme = this.themes.find(({ id }) => id === this.preference)
        ?? this.themes.find(({ id }) => id === DEFAULT_FILE_ICON_THEME_ID);
      return theme === undefined ? undefined : resolveFileIcon(theme, path, this.colorScheme);
    },
    subscribe: (listener: () => void): (() => void) => {
      this.listeners.add(listener);
      return () => { this.listeners.delete(listener); };
    },
  });

  update(themes: readonly QualifiedFileIconThemeContribution[], preference: string | undefined, colorScheme: ThemeColorScheme): void {
    const changed = preference !== this.preference || colorScheme !== this.colorScheme
      || themes.length !== this.themes.length || themes.some((theme, index) => theme !== this.themes[index]);
    this.themes = [...themes];
    this.preference = preference;
    this.colorScheme = colorScheme;
    if (changed) for (const listener of [...this.listeners]) {
      try { listener(); }
      catch (error) { console.warn("Failed to notify file icon subscriber", error); }
    }
  }
}

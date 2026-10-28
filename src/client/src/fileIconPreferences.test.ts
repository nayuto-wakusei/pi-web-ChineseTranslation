// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FILE_ICON_STORAGE_KEY, NO_FILE_ICONS, readStoredFileIconPreference, writeStoredFileIconPreference } from "./fileIconPreferences";
import { THEME_STORAGE_KEY } from "./theme";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("browser file icon preferences", () => {
  it("keeps None and unavailable selections separate from color themes, and reset removes the override", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "color preference");
    expect(readStoredFileIconPreference()).toBeUndefined();
    writeStoredFileIconPreference(NO_FILE_ICONS);
    expect(readStoredFileIconPreference()).toBe(NO_FILE_ICONS);
    writeStoredFileIconPreference("missing:theme");
    expect(readStoredFileIconPreference()).toBe("missing:theme");
    writeStoredFileIconPreference(undefined);
    expect(localStorage.getItem(FILE_ICON_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("color preference");
  });

  it("warns and ignores corrupt browser values", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const value of ["not json", "{}", '""']) {
      localStorage.setItem(FILE_ICON_STORAGE_KEY, value);
      expect(readStoredFileIconPreference()).toBeUndefined();
    }
    expect(warning).toHaveBeenCalledTimes(3);
  });

  it("reports blocked storage without blocking tab-local changes", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => { writeStoredFileIconPreference(NO_FILE_ICONS); }).not.toThrow();
    expect(warning).toHaveBeenCalledOnce();
  });
});

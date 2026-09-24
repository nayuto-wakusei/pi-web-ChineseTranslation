export interface NavigationPreferences {
  pinnedIds: string[];
}

const storageKey = "pi-web:navigation-preferences";

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadNavigationPreferences(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): NavigationPreferences {
  try {
    const value: unknown = JSON.parse(storage?.getItem(storageKey) ?? "null");
    if (typeof value === "object" && value !== null && "pinnedIds" in value) {
      const pins: unknown = Reflect.get(value, "pinnedIds");
      return {
        pinnedIds: Array.isArray(pins) ? [...new Set(pins.filter((id): id is string => typeof id === "string" && id !== ""))] : [],
      };
    }
  } catch {
    // Navigation preferences are optional when storage is blocked or malformed.
  }
  return { pinnedIds: [] };
}

export function saveNavigationPreferences(preferences: NavigationPreferences, storage: Pick<Storage, "setItem"> | undefined = browserStorage()): void {
  try {
    storage?.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // Ignore quota/privacy errors for optional browser preferences.
  }
}

export function isNavigationPinned(id: string, pinnedIds: readonly string[]): boolean {
  return pinnedIds.length === 0 || pinnedIds.includes(id);
}

export function pinnedNavigationTabs<T extends { id: string }>(tabs: readonly T[], pinnedIds: readonly string[]): T[] {
  return tabs.filter((tab) => isNavigationPinned(tab.id, pinnedIds));
}

export function toggleNavigationPin(id: string, pinnedIds: readonly string[], availableIds: readonly string[]): string[] {
  const current = pinnedIds.length === 0 ? [...availableIds] : [...pinnedIds];
  return current.includes(id) ? current.filter((pin) => pin !== id) : [...current, id];
}

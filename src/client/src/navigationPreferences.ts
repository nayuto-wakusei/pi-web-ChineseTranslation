export interface NavigationPreferences {
  pinnedIds: string[];
  mobileCollapsed: boolean;
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
    if (typeof value === "object" && value !== null) {
      const pins: unknown = "pinnedIds" in value ? value.pinnedIds : undefined;
      return {
        pinnedIds: Array.isArray(pins) ? [...new Set(pins.filter((id): id is string => typeof id === "string" && id !== ""))] : [],
        mobileCollapsed: "mobileCollapsed" in value && value.mobileCollapsed === true,
      };
    }
  } catch {
    // Navigation preferences are optional when storage is blocked or malformed.
  }
  return { pinnedIds: [], mobileCollapsed: false };
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

export function availableNavigationTabs<T extends { id: string }>(
  tabs: readonly T[],
  layout: { mobile: boolean; sideBySide: boolean },
): T[] {
  return tabs.filter((tab) => {
    if (tab.id === "navigation") return layout.mobile;
    if (tab.id === "chat") return !layout.sideBySide;
    return true;
  });
}

export function hasHiddenActiveNavigationTab<T extends { id: string }>(
  availableTabs: readonly T[],
  visibleTabs: readonly T[],
  selectedId: string | undefined,
): boolean {
  return selectedId !== undefined && availableTabs.some((tab) => tab.id === selectedId)
    && !visibleTabs.some((tab) => tab.id === selectedId);
}

export function selectedNavigationTab<T extends string>(
  mainView: T,
  workspaceTool: T | undefined,
  sideBySide: boolean,
  hasUnavailableRoute: boolean,
): T | undefined {
  if (hasUnavailableRoute) return undefined;
  if (!sideBySide && (mainView === "navigation" || mainView === "chat")) return mainView;
  return workspaceTool;
}

export function toggleNavigationPin(id: string, pinnedIds: readonly string[], availableIds: readonly string[]): string[] {
  // Empty pins mean "all"; materialize that full set before changing one pin.
  const current = pinnedIds.length === 0 ? [...availableIds] : [...pinnedIds];
  return current.includes(id) ? current.filter((pin) => pin !== id) : [...current, id];
}

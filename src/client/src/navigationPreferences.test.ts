import { describe, expect, it } from "vitest";
import { availableNavigationTabs, hasHiddenActiveNavigationTab, isNavigationPinned, loadNavigationPreferences, pinnedNavigationTabs, saveNavigationPreferences, selectedNavigationTab, toggleNavigationPin } from "./navigationPreferences";
import { MemoryStorage } from "./browserStorage.testSupport";

describe("navigation preferences", () => {
  it("shows every tab until the user explicitly pins destinations", () => {
    const tabs = [{ id: "chat" }, { id: "files" }, { id: "git" }];

    expect(pinnedNavigationTabs(tabs, [])).toEqual(tabs);
    expect(toggleNavigationPin("files", [], tabs.map((tab) => tab.id))).toEqual(["chat", "git"]);
  });

  it("retains unavailable destination pins and deduplicates persisted values", () => {
    const storage = new MemoryStorage();
    storage.setItem("pi-web:navigation-preferences", JSON.stringify({ pinnedIds: ["chat", "remote:workspace.inspect", "chat", 4] }));

    const preferences = loadNavigationPreferences(storage);
    expect(preferences.pinnedIds).toEqual(["chat", "remote:workspace.inspect"]);
    expect(isNavigationPinned("remote:workspace.inspect", preferences.pinnedIds)).toBe(true);
    expect(pinnedNavigationTabs([{ id: "chat" }, { id: "files" }], preferences.pinnedIds)).toEqual([{ id: "chat" }]);
  });

  it("round trips preferences and ignores malformed storage", () => {
    const storage = new MemoryStorage();
    saveNavigationPreferences({ pinnedIds: ["chat"], mobileCollapsed: true }, storage);

    expect(loadNavigationPreferences(storage)).toEqual({ pinnedIds: ["chat"], mobileCollapsed: true });
    storage.setItem("pi-web:navigation-preferences", "{");
    expect(loadNavigationPreferences(storage)).toEqual({ pinnedIds: [], mobileCollapsed: false });
  });

  it("keeps pin edits scoped to the complete navigation universe across layouts", () => {
    const all = [{ id: "navigation" }, { id: "chat" }, { id: "files" }, { id: "git" }];
    const desktop = availableNavigationTabs(all, { mobile: false, sideBySide: true });
    const middle = availableNavigationTabs(all, { mobile: false, sideBySide: false });
    const mobile = availableNavigationTabs(all, { mobile: true, sideBySide: false });

    expect(desktop.map(({ id }) => id)).toEqual(["files", "git"]);
    expect(middle.map(({ id }) => id)).toEqual(["chat", "files", "git"]);
    expect(mobile.map(({ id }) => id)).toEqual(["navigation", "chat", "files", "git"]);
    expect(toggleNavigationPin("files", [], all.map(({ id }) => id))).toEqual(["navigation", "chat", "git"]);
  });

  it("highlights the navigation button only when an available active tab is hidden", () => {
    const available = [{ id: "chat" }, { id: "files" }];
    expect(hasHiddenActiveNavigationTab(available, [{ id: "chat" }], "files")).toBe(true);
    expect(hasHiddenActiveNavigationTab(available, [{ id: "chat" }], "missing")).toBe(false);
    expect(hasHiddenActiveNavigationTab(available, [{ id: "chat" }], undefined)).toBe(false);
  });

  it("selects the workspace tool on wide layouts and never selects unavailable routes", () => {
    expect(selectedNavigationTab("chat", "core:workspace.git", true, false)).toBe("core:workspace.git");
    expect(selectedNavigationTab("chat", "core:workspace.files", false, false)).toBe("chat");
    expect(selectedNavigationTab("core:workspace.git", "core:workspace.git", false, false)).toBe("core:workspace.git");
    expect(selectedNavigationTab("core:workspace.missing", "core:workspace.files", true, true)).toBeUndefined();
  });
});

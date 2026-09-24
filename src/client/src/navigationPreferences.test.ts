import { describe, expect, it } from "vitest";
import { isNavigationPinned, loadNavigationPreferences, pinnedNavigationTabs, saveNavigationPreferences, toggleNavigationPin } from "./navigationPreferences";
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
    saveNavigationPreferences({ pinnedIds: ["chat"] }, storage);

    expect(loadNavigationPreferences(storage)).toEqual({ pinnedIds: ["chat"] });
    storage.setItem("pi-web:navigation-preferences", "{");
    expect(loadNavigationPreferences(storage)).toEqual({ pinnedIds: [] });
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspacePanelNavigation } from "./workspacePanelNavigation";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("workspace contribution navigation", () => {
  it("reads immutable alias snapshots and canonicalizes writes without losing route or unrelated keys", () => {
    window.history.replaceState({}, "", "/nested/?project=p&workspace=w&legacy.files--file=old&other.panel--tag=keep#anchor");
    const changed = vi.fn();
    const navigation = createWorkspacePanelNavigation("files:panel", ["legacy:files"], () => true, changed);
    expect(navigation.query).toEqual({ file: "old" });
    navigation.set("file", "new");
    navigation.set("page", 2, { replace: true });
    expect(navigation.query).toEqual({ file: "old" });
    expect(Object.isFrozen(navigation.query)).toBe(true);
    const url = new URL(window.location.href);
    expect(url.pathname).toBe("/nested/");
    expect(url.hash).toBe("#anchor");
    expect(url.searchParams.get("files.panel--file")).toBe("new");
    expect(url.searchParams.get("files.panel--page")).toBe("2");
    expect(url.searchParams.has("legacy.files--file")).toBe(false);
    expect(url.searchParams.get("other.panel--tag")).toBe("keep");
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("rejects retained contexts after selection or history changes", () => {
    window.history.replaceState({}, "", "/?files.panel--file=a");
    let current = true;
    const changed = vi.fn();
    const navigation = createWorkspacePanelNavigation("files:panel", [], () => current, changed);
    window.history.replaceState({}, "", "/?files.panel--file=from-history");
    navigation.set("file", "stale");
    expect(window.location.search).toBe("?files.panel--file=from-history");
    window.history.replaceState({}, "", "/?files.panel--file=a");
    current = false;
    navigation.set("file", "stale");
    expect(window.location.search).toBe("?files.panel--file=a");
    expect(changed).not.toHaveBeenCalled();
    expect(() => { navigation.set("../invalid", "a"); }).toThrow("Invalid contribution navigation key");
  });
});

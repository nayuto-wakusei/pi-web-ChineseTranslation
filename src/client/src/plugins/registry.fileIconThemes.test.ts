import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry";
import type { FileIconThemeContribution, PiWebPlugin } from "./types";

const theme: FileIconThemeContribution = {
  id: "files", name: "Files", file: { url: "https://icons.test/file.svg" },
  files: [{ extensions: [".ts"], icon: { url: "https://icons.test/typescript.svg" } }],
};
const plugin = (fileIconThemes: FileIconThemeContribution[], apiVersion: 4 | 5 = 5): PiWebPlugin => ({
  apiVersion, name: "File icons", activate: () => ({ contributions: { fileIconThemes } }),
});

describe("file icon theme registration", () => {
  it("qualifies immutable snapshots, filters disabled plugins, and removes contributions on shutdown", async () => {
    let enabled = true;
    const registry = new PluginRegistry({ isContributionEnabled: () => enabled });
    const source = structuredClone(theme);
    await registry.register({ id: "icons", plugin: plugin([source]) });
    source.file.url = "https://icons.test/changed.svg";
    const registered = registry.getFileIconThemes()[0];
    expect(registered).toEqual({ ...theme, id: "icons:files", localId: "files", pluginId: "icons" });
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered?.files?.[0]?.icon)).toBe(true);
    registry.getFileIconThemes().splice(0);
    expect(registry.getFileIconThemes()).toHaveLength(1);
    enabled = false;
    expect(registry.getFileIconThemes()).toEqual([]);
    enabled = true;
    registry.beginShutdown();
    expect(registry.getFileIconThemes()).toEqual([]);
    await registry.dispose();
    expect(registry.getFileIconThemes()).toEqual([]);
  });

  it("keeps localized display getters live while snapshotting icon rules", async () => {
    const registry = new PluginRegistry();
    let name = "Icons";
    const source = { ...theme, get name() { return name; }, get description() { return `${name} description`; } };
    await registry.register({ id: "icons", plugin: plugin([source]) });
    const registered = registry.getFileIconThemes()[0];
    name = "Symboles";
    source.file = { url: "https://icons.test/replaced.svg" };
    expect(registered?.name).toBe("Symboles");
    expect(registered?.description).toBe("Symboles description");
    expect(registered?.file.url).toBe(theme.file.url);
    await registry.dispose();
  });

  it("sorts by order then name and excludes machine-bound themes", async () => {
    const registry = new PluginRegistry();
    await registry.register({ id: "icons", plugin: plugin([
      { ...theme, id: "z", name: "Z" },
      { ...theme, id: "a", name: "A" },
      { ...theme, id: "first", name: "First", order: 1 },
    ]) });
    await registry.register({ id: "remote-icons", sourcePluginId: "other-icons", machineId: "remote", plugin: plugin([theme]) });
    expect(registry.getFileIconThemes().map((entry) => entry.id)).toEqual(["icons:first", "icons:a", "icons:z"]);
    await registry.dispose();
  });

  it("rejects duplicate IDs atomically, including collisions with other contribution kinds", async () => {
    const registry = new PluginRegistry();
    await expect(registry.register({ id: "icons", plugin: plugin([theme, theme]) })).rejects.toThrow("Duplicate contribution id");
    expect(registry.getFileIconThemes()).toEqual([]);
    await expect(registry.register({ id: "collision", plugin: {
      apiVersion: 5, name: "Collision", activate: () => ({ contributions: {
        fileIconThemes: [theme], themes: [{ id: "files", name: "Palette", colorScheme: "dark" }],
      } }),
    } })).rejects.toThrow("Duplicate contribution id");
    expect(registry.getFileIconThemes()).toEqual([]);
    await registry.dispose();
  });

  it("rejects v4 declarations, even an empty list", async () => {
    const registry = new PluginRegistry();
    await expect(registry.register({ id: "legacy", plugin: plugin([], 4) })).rejects.toThrow("require browser API v5");
    expect(registry.getFileIconThemes()).toEqual([]);
    await registry.dispose();
  });

  it("rejects invalid assets before publication", async () => {
    const registry = new PluginRegistry();
    await expect(registry.register({ id: "invalid", plugin: plugin([{ ...theme, file: { url: "<svg/>" } }]) })).rejects.toThrow();
    expect(registry.getFileIconThemes()).toEqual([]);
    await registry.dispose();
  });

  it("does not publish when start fails", async () => {
    const registry = new PluginRegistry();
    await expect(registry.register({ id: "failed", plugin: {
      apiVersion: 5, name: "Failed", activate: () => ({ contributions: { fileIconThemes: [theme] }, start: () => { throw new Error("start failed"); } }),
    } })).rejects.toThrow("start failed");
    expect(registry.getFileIconThemes()).toEqual([]);
    await registry.dispose();
  });
});

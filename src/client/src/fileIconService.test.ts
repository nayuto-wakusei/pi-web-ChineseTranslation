import { describe, expect, it, vi } from "vitest";
import { FileIconService, fileIconsCapabilityToken } from "./fileIconService";
import { NO_FILE_ICONS } from "./fileIconPreferences";
import type { QualifiedFileIconThemeContribution } from "./plugins/types";

const material: QualifiedFileIconThemeContribution = {
  id: "themes:material", pluginId: "themes", localId: "material", name: "Material",
  file: { url: "https://icons.test/material.svg", lightUrl: "https://icons.test/material-light.svg" },
};
const custom: QualifiedFileIconThemeContribution = {
  id: "custom:icons", pluginId: "custom", localId: "icons", name: "Custom",
  file: { url: "https://icons.test/custom.svg" },
};

describe("live app file icons", () => {
  it("defaults to Material, supports explicit None, and restores unavailable choices without rewriting them", () => {
    const service = new FileIconService();
    const capability = service.capability;
    expect(capability.resolveIcon("file.ts")).toBeUndefined();
    service.update([material, custom], undefined, "dark");
    expect(capability.resolveIcon("file.ts")).toBe(material.file.url);
    service.update([material, custom], NO_FILE_ICONS, "light");
    expect(capability.resolveIcon("file.ts")).toBeUndefined();
    service.update([material], custom.id, "light");
    expect(capability.resolveIcon("file.ts")).toBe(material.file.lightUrl);
    service.update([material, custom], custom.id, "light");
    expect(capability.resolveIcon("file.ts")).toBe(custom.file.url);
    service.update([custom], "missing:icons", "dark");
    expect(capability.resolveIcon("file.ts")).toBeUndefined();
  });

  it("notifies retained subscribers for selection, resolved color scheme, and registry rebuilds, with cleanup", () => {
    const service = new FileIconService();
    service.update([material], undefined, "dark");
    const changed = vi.fn();
    const unsubscribe = service.capability.subscribe(changed);
    service.update([material], undefined, "dark");
    expect(changed).not.toHaveBeenCalled();
    service.update([material], undefined, "light");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(service.capability.resolveIcon("file")).toBe(material.file.lightUrl);
    service.update([{ ...material, file: { url: "https://icons.test/rebuilt.svg" } }], undefined, "light");
    expect(changed).toHaveBeenCalledTimes(2);
    expect(service.capability.resolveIcon("file")).toBe("https://icons.test/rebuilt.svg");
    service.update([material], NO_FILE_ICONS, "light");
    expect(changed).toHaveBeenCalledTimes(3);
    unsubscribe();
    service.update([], undefined, "dark");
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("isolates subscriber failures so other mounted consumers still update", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = new FileIconService();
    const error = new Error("consumer failed");
    const healthy = vi.fn();
    service.capability.subscribe(() => { throw error; });
    service.capability.subscribe(healthy);
    service.update([material], undefined, "light");
    expect(healthy).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledExactlyOnceWith("Failed to notify file icon subscriber", error);
    warning.mockRestore();
  });

  it("exposes the v1 host token and rejects incompatible values", () => {
    const service = new FileIconService();
    expect(fileIconsCapabilityToken).toMatchObject({ pluginId: "pi-web", id: "file-icons", version: 1 });
    expect(fileIconsCapabilityToken.parse(service.capability)).toBe(service.capability);
    expect(() => fileIconsCapabilityToken.parse({ resolveIcon: () => undefined })).toThrow("unavailable");
  });
});

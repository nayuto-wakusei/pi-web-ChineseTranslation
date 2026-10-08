import { describe, expect, it } from "vitest";
import { isPiWebBundledPluginId, isPiWebPluginId, isReservedPiWebPluginId } from "./pluginIds.js";

describe("PI WEB plugin ID namespaces", () => {
  it.each(["core", "themes", "machine.remote.files", "machine.", "pi-web", "pi-web.terminal"])(
    "reserves host-owned ID %s",
    (id) => { expect(isReservedPiWebPluginId(id)).toBe(true); },
  );

  it.each(["files", "core-tools", "themes-custom", "machine", "machine-tools", "pi-web-tools", "captains-log"])(
    "leaves nonreserved ID %s available",
    (id) => {
      expect(isPiWebPluginId(id)).toBe(true);
      expect(isReservedPiWebPluginId(id)).toBe(false);
    },
  );

  it("recognizes only the bundled namespace as eligible for a bundled trust exception", () => {
    expect(isPiWebBundledPluginId("pi-web")).toBe(true);
    expect(isPiWebBundledPluginId("pi-web.terminal")).toBe(true);
    expect(isPiWebBundledPluginId("core")).toBe(false);
    expect(isPiWebBundledPluginId("machine.remote.files")).toBe(false);
    expect(isPiWebBundledPluginId("pi-web-tools")).toBe(false);
  });
});

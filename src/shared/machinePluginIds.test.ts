import { describe, expect, it } from "vitest";
import { machineScopedBundledPluginId, machineScopedManifestPluginId, machineScopedPluginId, parseMachineScopedPluginId } from "./machinePluginIds";

describe("machine-scoped plugin ids", () => {
  it.each(["core", "themes", "machine.remote.tools", "pi-web", "pi-web.terminal"])("rejects reserved user id %s", (id) => {
    expect(() => machineScopedPluginId("remote", id)).toThrow("Reserved PI WEB plugin id");
  });

  it("preserves the encoded identity of a validated bundled plugin", () => {
    const id = machineScopedBundledPluginId("remote-a", "pi-web.terminal");
    expect(id).toBe("machine.72656d6f74652d61.pi-web.terminal");
    expect(machineScopedManifestPluginId("remote-a", "pi-web.terminal")).toBe(id);
    expect(parseMachineScopedPluginId(id)).toEqual({ machineId: "remote-a", pluginId: "pi-web.terminal" });
    expect(() => machineScopedBundledPluginId("remote-a", "custom")).toThrow("bundled plugin id is required");
    expect(parseMachineScopedPluginId("machine.72656d6f74652d61.core")).toBeUndefined();
  });

  it("encodes machine ids into valid plugin ids and decodes them", () => {
    const scoped = machineScopedPluginId("550e8400-e29b-41d4-a716-446655440000", "project-tools");

    expect(scoped).toMatch(/^machine\.[0-9a-f]+\.project-tools$/u);
    expect(parseMachineScopedPluginId(scoped)).toEqual({ machineId: "550e8400-e29b-41d4-a716-446655440000", pluginId: "project-tools" });
  });

  it("leaves normal plugin ids unparsed", () => {
    expect(parseMachineScopedPluginId("project-tools")).toBeUndefined();
  });
});

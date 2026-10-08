import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadExternalPlugins, resolvePluginModuleUrl } from "./external";
import { PluginRegistry } from "./registry";
import { machineScopedBundledPluginId, machineScopedPluginId } from "../../../shared/machinePluginIds";

beforeEach(() => {
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("external plugin manifests", () => {
  it("accepts a host-validated bundled namespace on the owning remote machine", async () => {
    const result = await loadExternalPlugins(undefined, {
      machineId: "remote-a",
      plugins: [{ id: "pi-web.terminal", source: "bundled", scope: "bundled", module: "./terminal/plugin.js", machineSpecific: true }],
      moduleLoader: () => Promise.resolve({ default: { apiVersion: 4, name: "Terminal", activate: () => ({ contributions: {} }) } }),
    });
    expect(result.failures).toEqual([]);
    expect(result.registrations[0]).toMatchObject({
      id: machineScopedBundledPluginId("remote-a", "pi-web.terminal"),
      machineId: "remote-a", sourcePluginId: "pi-web.terminal",
    });
  });

  it.each(["core", "themes", "machine.remote.tools", "pi-web", "pi-web.terminal"])("rejects reserved user manifest id %s before importing code", async (id) => {
    const moduleLoader = vi.fn();
    await expect(loadExternalPlugins(undefined, {
      plugins: [{ id, source: "local", scope: "local", module: "./plugin.js", machineSpecific: true }],
      moduleLoader,
    })).rejects.toThrow("Reserved plugin manifest id");
    expect(moduleLoader).not.toHaveBeenCalled();
  });

  it("keeps source and machine-scoped runtime identities through real loading and activation", async () => {
    const activate = vi.fn(() => ({ contributions: {} }));
    const result = await loadExternalPlugins(undefined, {
      machineId: "remote-a",
      plugins: [{ id: "example", module: "./example/plugin.js", machineSpecific: false }],
      moduleLoader: () => Promise.resolve({ default: { apiVersion: 4, name: "Example", activate } }),
    });
    expect(result.failures).toEqual([]);
    const registry = new PluginRegistry();
    try {
      for (const registration of result.registrations) await registry.register(registration);
      expect(activate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        pluginId: "example",
        runtimePluginId: machineScopedPluginId("remote-a", "example"),
      }));
    } finally {
      await registry.dispose();
    }
  });

  it("fetches the default manifest through the application base", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadExternalPlugins()).resolves.toEqual({ registrations: [], failures: [] });

    expect(fetchMock).toHaveBeenCalledWith("https://pi.example.test/pi-web-plugins/manifest.json", { cache: "no-store" });
  });

  it("loads manifest-relative modules from a nested deployment", async () => {
    const manifestUrl = "https://pi.example.test/test/ai/pi-web-plugins/manifest.json";
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      plugins: [{ id: "info", module: "./info/pi-web-plugin.js?v=1", machineSpecific: false }],
    }))));
    const moduleLoader = vi.fn(() => Promise.resolve({
      default: { apiVersion: 4, name: "Info", activate: () => ({ contributions: {} }) },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const registrations = await loadExternalPlugins(manifestUrl, { moduleLoader });

    expect(fetchMock).toHaveBeenCalledWith(manifestUrl, { cache: "no-store" });
    expect(moduleLoader).toHaveBeenCalledWith("https://pi.example.test/test/ai/pi-web-plugins/info/pi-web-plugin.js?v=1");
    expect(registrations.registrations).toMatchObject([{ id: "info", machineSpecific: false, plugin: { apiVersion: 4, name: "Info" } }]);
  });

  it("keeps management plugin modules under a nested application base", () => {
    vi.stubGlobal("location", { href: "https://pi.example.test/test/ai/?embed=management&token=entry" });
    const manifestUrl = "https://pi.example.test/test/ai/pi-web-plugins/manifest.json";

    expect(resolvePluginModuleUrl("./info/pi-web-plugin.js?v=1", manifestUrl))
      .toBe("https://pi.example.test/test/ai/pi-web-plugins/info/pi-web-plugin.js?v=1");
  });

  it("treats root-style modules from existing manifests as application-root paths", () => {
    const rootManifestUrl = "https://pi.example.test/pi-web-plugins/manifest.json";
    const nestedManifestUrl = "https://pi.example.test/test/ai/pi-web-plugins/manifest.json";

    expect(resolvePluginModuleUrl("/pi-web-plugins/info/pi-web-plugin.js?v=1", rootManifestUrl, {
      viteBaseUrl: "/",
      documentBaseUrl: "https://pi.example.test/",
    })).toBe("https://pi.example.test/pi-web-plugins/info/pi-web-plugin.js?v=1");
    expect(resolvePluginModuleUrl("/pi-web-plugins/info/pi-web-plugin.js?v=1", nestedManifestUrl, {
      viteBaseUrl: "./",
      documentBaseUrl: "https://pi.example.test/test/ai/",
    })).toBe("https://pi.example.test/test/ai/pi-web-plugins/info/pi-web-plugin.js?v=1");
  });
});

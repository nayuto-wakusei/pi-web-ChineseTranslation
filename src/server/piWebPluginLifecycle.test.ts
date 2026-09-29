import { describe, expect, it } from "vitest";
import { WORKSPACE_PROVIDER_RUNTIME_PROTOCOL_VERSION } from "./workspaces/workspaceCatalog.js";
import { reconcilePiWebPluginLifecycle } from "./piWebPluginLifecycle.js";
import type { PiWebPluginCatalogEntry, PiWebPluginCatalogSnapshot } from "./piWebPluginCatalog.js";
import type { WorkspaceProviderRuntimeSnapshot } from "./workspaces/workspaceCatalog.js";
import type { ServerPluginRuntimeRecord } from "./plugins/serverPluginRuntime.js";

describe("PI WEB plugin lifecycle", () => {
  it("publishes paired backend versions on the plugin list used by management embed", () => {
    const plugin = catalogPlugin();
    const reconciliation = reconcilePiWebPluginLifecycle(
      snapshot(plugin),
      { status: "available", snapshot: runtimeSnapshot(runtimeRecord(plugin)) },
      () => "/pi-web-plugins/git/pi-web-plugin.js",
    );

    expect(reconciliation.response.plugins).toEqual([expect.objectContaining({
      id: "git",
      module: "/pi-web-plugins/git/pi-web-plugin.js",
      backendRevision: "server-rev",
      pairedRequestVersion: 1,
      pairedChannelVersion: 1,
    })]);
    expect(reconciliation.browserPlugins).toEqual([expect.objectContaining({
      backendRevision: "server-rev",
      pairedRequestVersion: 1,
      pairedChannelVersion: 1,
    })]);
  });
});

function snapshot(plugin: PiWebPluginCatalogEntry): PiWebPluginCatalogSnapshot {
  return { plugins: [plugin], diagnostics: [] };
}

function catalogPlugin(): PiWebPluginCatalogEntry {
  return {
    id: "git",
    packageRoot: "/plugins/git",
    browserModule: { path: "pi-web-plugin.js", filePath: "/plugins/git/pi-web-plugin.js", revision: "browser-rev" },
    serverModule: { path: "server-plugin.js", filePath: "/plugins/git/server-plugin.js", revision: "server-rev" },
    source: "bundled:git",
    scope: "bundled",
    machineSpecific: false,
    enabled: true,
    settings: {},
    settingsRevision: "settings-rev",
  };
}

function runtimeRecord(plugin: PiWebPluginCatalogEntry): ServerPluginRuntimeRecord {
  return {
    pluginId: plugin.id,
    source: plugin.source,
    scope: plugin.scope,
    moduleRevision: "server-rev",
    browserRevision: "browser-rev",
    settingsRevision: plugin.settingsRevision,
    machineSpecific: false,
    pairedRequestVersion: 1,
    pairedChannelVersion: 1,
    state: "active",
  };
}

function runtimeSnapshot(record: ServerPluginRuntimeRecord): WorkspaceProviderRuntimeSnapshot {
  return {
    protocolVersion: WORKSPACE_PROVIDER_RUNTIME_PROTOCOL_VERSION,
    records: [record],
    health: [],
    diagnostics: [],
  };
}

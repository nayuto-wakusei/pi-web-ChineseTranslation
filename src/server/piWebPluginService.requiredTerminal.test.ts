import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiWebPluginCatalog, PiWebPluginService, PiWebPluginManifestRuntimeError } from "./piWebPluginService.js";
import { createWorkspaceProviderRuntimeSnapshot, WorkspaceCatalogProtocolError } from "./workspaces/workspaceCatalog.js";
import type { ServerPluginRuntimeRecord } from "./plugins/serverPluginRuntime.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("required Terminal manifest runtime boundary", () => {
  it.each(["unavailable", "incompatible"] as const)("fails closed for %s runtime, including desired no-Terminal recovery", async (status) => {
    const service = new PiWebPluginService({ roots: [], packageProvider: false, configProvider: () => ({}), recoveryProvider: () => ({ safeStart: "none" }), runtimeProvider: { providerRuntime: () => Promise.reject(status === "incompatible" ? new WorkspaceCatalogProtocolError("old daemon") : new Error("offline")) } });
    await expect(service.manifest()).rejects.toBeInstanceOf(PiWebPluginManifestRuntimeError);
    await expect(service.manifest()).rejects.toMatchObject({ statusCode: status === "incompatible" ? 409 : 503 });
    expect((await service.plugins()).serverRuntime).toMatchObject({ status, terminalMode: "required" });
  });

  it("allows no-Terminal browser discovery only from an active safe-start-none snapshot", async () => {
    const service = new PiWebPluginService({ roots: [], packageProvider: false, configProvider: () => ({}), runtimeProvider: { providerRuntime: () => Promise.resolve(createWorkspaceProviderRuntimeSnapshot([], [], "none")) } });
    await expect(service.manifest()).resolves.toEqual({ lifecycleVersion: 2, terminalMode: "recovery-disabled", plugins: [] });
  });

  it("requires a bundled machine-specific dual Terminal entry and publishes it first", async () => {
    const { catalog, records } = await terminalCatalog();
    const service = new PiWebPluginService({ catalog, runtimeProvider: { providerRuntime: () => Promise.resolve(createWorkspaceProviderRuntimeSnapshot(records, [])) } });
    const manifest = await service.manifest();
    expect(manifest).toMatchObject({ lifecycleVersion: 2, terminalMode: "required", plugins: [{ id: "pi-web.terminal", pairedRequestVersion: 1, pairedChannelVersion: 1 }, { id: "first-alphabetically" }] });
    expect((await service.plugins()).plugins[0]).toMatchObject({ id: "pi-web.terminal", required: true });
    expect(await service.readAsset("pi-web.terminal", "server-plugin.js")).toBeUndefined();
    expect(await service.readAsset("pi-web.terminal", "terminalService.js")).toBeUndefined();
  });

  it.each(["paired", "stale", "missing", "browser-missing"])("rejects %s Terminal instead of publishing ordinary plugins", async (problem) => {
    const { catalog, records, terminalDir } = await terminalCatalog();
    const record = records[0];
    if (record === undefined) throw new Error("Missing Terminal fixture record");
    if (problem === "paired") {
      records[0] = { ...record };
      delete records[0].pairedChannelVersion;
    }
    if (problem === "stale") records[0] = { ...record, moduleRevision: "stale" };
    if (problem === "missing") records.splice(0, 1);
    if (problem === "browser-missing") await rm(join(terminalDir, "browser/pi-web-plugin.js"));
    const service = new PiWebPluginService({ catalog, runtimeProvider: { providerRuntime: () => Promise.resolve(createWorkspaceProviderRuntimeSnapshot(records, [])) } });
    await expect(service.manifest()).rejects.toThrow();
  });
});

async function terminalCatalog() {
  const root = await mkdtemp(join(tmpdir(), "pi-web-terminal-manifest-"));
  roots.push(root);
  const terminalDir = join(root, "terminal");
  await mkdir(join(terminalDir, "browser"), { recursive: true });
  await writeFile(join(terminalDir, "package.json"), JSON.stringify({ piWeb: { plugins: [{ id: "pi-web.terminal", browserRoot: "browser", module: "browser/pi-web-plugin.js", serverModule: "server-plugin.js", machineSpecific: true }] } }));
  await writeFile(join(terminalDir, "browser/pi-web-plugin.js"), "export default {};");
  await writeFile(join(terminalDir, "server-plugin.js"), "export default {};");
  await writeFile(join(terminalDir, "terminalService.js"), "export {};");
  await mkdir(join(root, "ordinary"));
  await writeFile(join(root, "ordinary/package.json"), JSON.stringify({ piWeb: { plugins: [{ id: "first-alphabetically", browserRoot: ".", module: "browser.js" }] } }));
  await writeFile(join(root, "ordinary/browser.js"), "export default {};");
  const catalog = new PiWebPluginCatalog({ roots: [{ path: root, source: "bundled", scope: "bundled" }], packageProvider: false, configProvider: () => ({}) });
  const terminal = (await catalog.snapshot()).plugins.find(({ id }) => id === "pi-web.terminal");
  if (terminal?.serverModule === undefined || terminal.browserModule === undefined) throw new Error("Missing Terminal fixture modules");
  const records: ServerPluginRuntimeRecord[] = [{ pluginId: terminal.id, source: terminal.source, scope: terminal.scope, moduleRevision: terminal.serverModule.revision, browserRevision: terminal.browserModule.revision, settingsRevision: terminal.settingsRevision, machineSpecific: true, pairedRequestVersion: 1, pairedChannelVersion: 1, state: "active" }];
  return { catalog, records, terminalDir };
}

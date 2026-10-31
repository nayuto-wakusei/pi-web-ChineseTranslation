import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiWebPluginCatalog } from "../../src/server/piWebPluginCatalog.js";
import { createServerPluginRuntime } from "../../src/server/plugins/serverPluginRuntime.js";
import { WorkspaceProviderRegistry } from "../../src/server/workspaces/workspaceProviderRegistry.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("bundled Git package metadata", () => {
  it("is discovered as one bundled, machine-specific dual-entry plugin", async () => {
    const { catalog } = await gitCatalogFixture(true);

    await expect(catalog.snapshot()).resolves.toMatchObject({
      plugins: [{
        id: "git",
        source: "bundled",
        scope: "bundled",
        machineSpecific: true,
        enabled: true,
        browserRoot: { path: "browser" },
        browserModule: { path: "browser/pi-web-plugin.js" },
        serverModule: { path: "server-plugin.js" },
      }],
      diagnostics: [],
    });
  });


  it("leaves the kernel folder workspace when Git is disabled before import", async () => {
    const { catalog, root } = await gitCatalogFixture(false);
    const importer = vi.fn(() => Promise.reject(new Error("disabled Git module was imported")));
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = await createServerPluginRuntime({ catalog, dataDir: join(root, "data"), importer, logger, enforceRequiredTerminal: false });
    const registry = new WorkspaceProviderRegistry({ contributions: runtime.providerContributions(), logger });

    const resolution = await registry.resolve({
      id: "project-1",
      name: "Project",
      path: root,
      createdAt: "2026-07-27T00:00:00.000Z",
    });

    expect(importer).not.toHaveBeenCalled();
    expect(runtime.healthRecords()).toEqual([expect.objectContaining({
      pluginId: "git",
      state: "disabled",
      message: "disabled in PI WEB config",
    })]);
    expect(resolution).toMatchObject({
      status: "folder",
      workspaces: [{ path: root, isMain: true }],
    });
    expect(resolution.workspaces[0]).not.toHaveProperty("provider");
    expect(runtime.pairedBackendContributions()).toEqual([]);
    expect(importer).not.toHaveBeenCalled();
    await runtime.stop();
  });
});


async function gitCatalogFixture(enabled: boolean): Promise<{ catalog: PiWebPluginCatalog; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-git-package-"));
  tempRoots.push(root);
  const pluginsRoot = join(root, "plugins");
  const pluginRoot = join(pluginsRoot, "git");
  await mkdir(join(pluginRoot, "browser"), { recursive: true });
  await Promise.all([
    writeFile(join(pluginRoot, "package.json"), await readFile("pi-web-plugins/git/package.json", "utf8"), "utf8"),
    writeFile(join(pluginRoot, "browser", "pi-web-plugin.js"), "export default {};\n", "utf8"),
    writeFile(join(pluginRoot, "server-plugin.js"), "export default {};\n", "utf8"),
  ]);
  return {
    root,
    catalog: new PiWebPluginCatalog({
      roots: [{ path: pluginsRoot, source: "bundled", scope: "bundled" }],
      packageProvider: false,
      configProvider: () => ({ plugins: { git: { enabled } } }),
    }),
  };
}

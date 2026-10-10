import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTerminalPackage } from "../../scripts/build-plugins.mjs";
import { PiWebPluginCatalog } from "../../src/server/piWebPluginCatalog.js";
import { PiWebPluginService } from "../../src/server/piWebPluginService.js";
import { createServerPluginRuntime } from "../../src/server/plugins/serverPluginRuntime.js";
import { createWorkspaceProviderRuntimeSnapshot } from "../../src/server/workspaces/workspaceCatalog.js";
import { REQUIRED_TERMINAL_SERVICE_CAPABILITY } from "../../src/server/terminals/requiredTerminalService.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("bundled Terminal package", () => {
  it("declares one required-shaped machine-specific dual entry", async () => {
    const metadata: unknown = JSON.parse(await readFile("pi-web-plugins/terminal/package.json", "utf8"));

    expect(metadata).toMatchObject({
      private: true,
      type: "module",
      piWeb: {
        plugins: [{
          id: "pi-web.terminal",
          browserRoot: "browser",
          module: "browser/pi-web-plugin.js",
          serverModule: "server-plugin.js",
          machineSpecific: true,
        }],
      },
    });
  });

  it("builds a package-complete self-contained browser graph and importable server graph", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-terminal-package-"));
    tempRoots.push(root);
    const packageRoot = join(root, "plugins", "terminal");
    await buildTerminalPackage(resolve("pi-web-plugins/terminal"), packageRoot);

    const files = (await readdir(packageRoot, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(packageRoot, join(entry.parentPath, entry.name)).split(sep).join("/"))
      .sort();
    expect(files).toEqual([
      "browser/pi-web-plugin.js",
      "package.json",
      "server-plugin.js",
      "terminalService.js",
    ]);
    const browserSource = await readFile(join(packageRoot, "browser", "pi-web-plugin.js"), "utf8");
    expect(browserSource).not.toMatch(/(?:from\s*["']|import\s*\()[^"']*(?:@jmfederico\/pi-web|src\/)/u);
    expect(browserSource).not.toMatch(/(?:from\s*["']|import\s*\()[^"']*@chainingintention\/pi-web-cn/u);
    expect(browserSource).not.toMatch(/sourceMappingURL/u);
    expect(browserSource).toContain("pi-web-terminal-panel");
    expect(browserSource).toContain("terminal.attach");
    expect(browserSource).toContain("terminal.list-runs");
    expect(browserSource).not.toContain("terminal-command-runs");
    expect(browserSource).not.toContain("/terminals");
    const serverSource = await readFile(join(packageRoot, "server-plugin.js"), "utf8");
    expect(serverSource).toContain('from "./terminalService.js"');
    expect(serverSource).not.toContain("src/server");

    const catalog = new PiWebPluginCatalog({
      roots: [{ path: join(root, "plugins"), source: "bundled", scope: "bundled" }],
      packageProvider: false,
      configProvider: () => ({}),
    });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runtime = await createServerPluginRuntime({
      dataDir: join(root, "data"),
      catalog,
      logger,
      importer: async (moduleUrl) => {
        const imported: unknown = await import(moduleUrl);
        return imported;
      },
      noticeSink: () => undefined,
    });
    try {
      const health = await runtime.inspectHealth();
      const snapshot = createWorkspaceProviderRuntimeSnapshot(
        runtime.healthRecords(),
        health,
        runtime.safeStartLevel(),
        runtime.catalogDiagnostics(),
      );
      const service = new PiWebPluginService({
        catalog,
        runtimeProvider: { providerRuntime: () => Promise.resolve(snapshot) },
      });

      expect(runtime.resolve(REQUIRED_TERMINAL_SERVICE_CAPABILITY)).toBeDefined();
      const manifest = await service.manifest();
      expect(manifest).toMatchObject({
        lifecycleVersion: 2,
        terminalMode: "required",
        plugins: [{
          id: "pi-web.terminal",
          pairedRequestVersion: 1,
          pairedChannelVersion: 1,
          source: "bundled",
          scope: "bundled",
          machineSpecific: true,
        }],
      });
      expect(manifest.plugins[0]?.module).toMatch(/^\/pi-web-plugins\/pi-web\.terminal\/browser\/pi-web-plugin\.js\?v=sha256%3A[a-f\d]{64}$/u);
      const serverModule = (await catalog.snapshot()).plugins[0]?.serverModule;
      expect(serverModule === undefined ? undefined : pathToFileURL(serverModule.filePath).protocol).toBe("file:");
    } finally {
      await runtime.stop();
    }
  });
});

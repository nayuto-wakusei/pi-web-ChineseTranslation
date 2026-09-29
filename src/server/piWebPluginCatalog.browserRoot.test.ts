import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiWebPluginCatalog } from "./piWebPluginCatalog.js";

describe("PI WEB plugin package keys", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("rejects unknown package keys including browserRoot", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-plugin-keys-"));
    roots.push(root);
    const pluginRoot = join(root, "plugins", "mermaid");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(join(pluginRoot, "package.json"), `${JSON.stringify({
      piWeb: { plugins: [{ id: "mermaid", module: "pi-web-plugin.js", browserRoot: "browser" }] },
    })}\n`);
    await writeFile(join(pluginRoot, "pi-web-plugin.js"), "export default {};\n");

    const snapshot = await new PiWebPluginCatalog({
      roots: [{ path: join(root, "plugins"), source: "test", scope: "local" }],
      packageProvider: false,
      configProvider: () => ({}),
    }).snapshot();

    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.diagnostics[0]?.message).toContain("unknown key \"browserRoot\"");
  });
});

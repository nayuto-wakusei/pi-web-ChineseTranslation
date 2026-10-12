import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicApiDeclarationPaths = [
  "plugin-api.d.ts",
  "server-plugin-api.d.ts",
  "shared/pluginApiTypes.d.ts",
];

describe("public API delivery artifacts", () => {
  it("keeps test-support modules out of the emitted production graph", async () => {
    const files = await readdir(join(repoRoot, "dist"), { recursive: true });
    expect(files).toContain(join("server", "app.js"));
    expect(files.filter((file) => file.includes(".testSupport."))).toEqual([]);
  });

  it("ships Relay skills without test-support artifacts in the actual npm tarball", async () => {
    const npmExecPath = process.env["npm_execpath"];
    if (!npmExecPath) throw new Error("Run artifact checks through npm to inspect the published package");
    const { stdout } = await promisify(execFile)(process.execPath, [
      npmExecPath, "pack", "--dry-run", "--json", "--ignore-scripts",
    ], { cwd: repoRoot, encoding: "utf8" });
    const results = JSON.parse(stdout);
    expect(results).toHaveLength(1);
    const files = results[0].files.map((file) => file.path);
    expect(files).toContain("dist/server/app.js");
    expect(files).toContain("skills/relay/SKILL.md");
    expect(files).toContain("skills/relay-runner/SKILL.md");
    expect(files.filter((file) => file.includes(".testSupport."))).toEqual([]);
  });

  it("keeps the browser API type-only and exports the supported server runtime contract", async () => {
    const metadata = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    expect(metadata.exports).toEqual({
      "./plugin-api": { types: "./dist/plugin-api.d.ts" },
      "./server-plugin-api": {
        types: "./dist/server-plugin-api.d.ts",
        import: "./dist/server-plugin-api.js",
      },
    });
    expect(metadata.typesVersions).toEqual({
      "*": {
        "plugin-api": ["dist/plugin-api.d.ts"],
        "server-plugin-api": ["dist/server-plugin-api.d.ts"],
      },
    });
  });

  it("matches the committed browser and server plugin API declaration baseline", async () => {
    for (const declarationPath of publicApiDeclarationPaths) {
      const [actual, baseline] = await Promise.all([
        readFile(join(repoRoot, "dist", declarationPath), "utf8"),
        readFile(join(repoRoot, "test-fixtures", "plugin-api-baseline", declarationPath), "utf8"),
      ]);
      expect(
        normalizeLineEndings(actual),
        `${declarationPath} changed; update the baseline only for an intentional public API change`,
      ).toBe(normalizeLineEndings(baseline));
      expect(
        actual,
        `${declarationPath} must not expose the host-internal terminal command-run filter`,
      ).not.toContain("TerminalCommandRunFilter");
    }
  });
});

function normalizeLineEndings(contents) {
  return contents.replaceAll("\r\n", "\n");
}

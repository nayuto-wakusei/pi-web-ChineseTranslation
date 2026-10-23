import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("production client build contents", () => {
  it("emits built-in theme palettes as separately loadable CSS files", async () => {
    const assetsDir = join(repoRoot, "dist/client/assets");
    const files = await readdir(assetsDir);
    const entry = files.find((file) => /^index-.*\.js$/.test(file));
    expect(entry).toBeDefined();
    const pending = [entry];
    const reachable = new Map();
    while (pending.length > 0) {
      const file = pending.pop();
      if (reachable.has(file)) continue;
      expect(files).toContain(file);
      const source = await readFile(join(assetsDir, file), "utf8");
      reachable.set(file, source);
      for (const { fileName } of ts.preProcessFile(source, true, true).importedFiles) {
        if (fileName.startsWith("./") && fileName.endsWith(".js")) pending.push(fileName.slice(2));
      }
    }
    const code = [...reachable.values()].join("\n");
    for (const id of ["classic", "pi-web-dark", "pi-web-light"]) {
      const palettes = files.filter((file) => file.startsWith(`${id}-`) && file.endsWith(".css"));
      expect(palettes).toHaveLength(1);
      expect(code).toContain(palettes[0]);
      expect(await readFile(join(assetsDir, palettes[0]), "utf8")).toContain("--pi-bg:");
    }
  });

  it("emits deployment-relative HTML and PWA URLs", async () => {
    const outDir = join(repoRoot, "dist/client");
    const html = await readFile(join(outDir, "index.html"), "utf8");
    const references = htmlAssetReferences(html);
    expect(references).toContain("./favicon.svg");
    expect(references).toContain("./apple-touch-icon.png");
    expect(references).toContain("./manifest.webmanifest");
    const manifestLink = /<link\b[^>]*\brel="manifest"[^>]*>/.exec(html)?.[0];
    expect(manifestLink).toBeDefined();
    expect(manifestLink).toContain('crossorigin="use-credentials"');
    expect(references).toContainEqual(expect.stringMatching(/^\.\/assets\/index-[^/]+\.js$/));
    expect(references.filter((reference) => reference.startsWith("/"))).toEqual([]);

    const manifest = JSON.parse(await readFile(join(outDir, "manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({
      start_url: "./",
      scope: "./",
      icons: [
        { src: "./pwa-icon-192.png" },
        { src: "./pwa-icon-512.png" },
      ],
    });
  });
});

function htmlAssetReferences(html) {
  return Array.from(html.matchAll(/\b(?:href|src)="([^"]+)"/g), (match) => match[1] ?? "");
}

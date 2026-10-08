import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDirectory, buildPiPackages, buildFilesBrowserPackage, filesBrowserBuildConfig, buildCaptainsLogBrowserPackage, buildMermaidPackage } from "./build-plugins.mjs";

let tempDir;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-build-plugins-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("Files browser package", () => {
  it("ships only the manifest and a self-contained browser build with relative chunks", async () => {
    const source = join(tempDir, "files");
    const target = join(tempDir, "out");
    await mkdir(source);
    const manifest = { piWeb: { module: "browser/pi-web-plugin.js" } };
    await writeFile(join(source, "package.json"), JSON.stringify(manifest));
    await writeFile(join(source, "private.ts"), "must not ship as source");
    const configs = [];
    await buildFilesBrowserPackage(source, target, (config) => { configs.push(config); return Promise.resolve(); });
    expect(await readdir(target)).toEqual(["package.json"]);
    expect(JSON.parse(await readFile(join(target, "package.json"), "utf8"))).toEqual(manifest);
    expect(configs).toEqual([filesBrowserBuildConfig(source, target)]);
    expect(configs[0].base).toBe("./");
    expect(configs[0].build.outDir).toBe(join(target, "browser"));
    expect(configs[0].build.rollupOptions.output.entryFileNames).toBe("pi-web-plugin.js");
    expect(configs[0].build.rollupOptions.external).toBeUndefined();
  });
});

describe("Mermaid browser package", () => {
  it("bundles the renderer and writes the isolated engine alongside its entry without deleting the entry", async () => {
    const source = join(tempDir, "mermaid");
    const target = join(tempDir, "out");
    await mkdir(source);
    const manifest = { piWeb: { module: "browser/pi-web-plugin.js" } };
    await writeFile(join(source, "package.json"), JSON.stringify(manifest));
    const configs = [];
    await buildMermaidPackage(source, target, (config) => {
      configs.push(config);
      return Promise.resolve();
    });
    expect(configs[0]).toEqual(filesBrowserBuildConfig(source, target));
    expect(configs[1].build.outDir).toBe(join(target, "browser"));
    expect(configs[1].build.emptyOutDir).toBe(false);
    expect(configs[1].build.lib.entry).toBe(join(source, "mermaidRuntime.ts"));
    expect(configs[1].build.lib.fileName()).toBe("mermaidRuntime.js");
    expect(JSON.parse(await readFile(join(target, "package.json"), "utf8"))).toEqual(manifest);
  });
});

describe("Captain's Log browser package", () => {
  it("uses the independent package config and writes inside the shipped Pi package", async () => {
    const source = join(tempDir, "captains-log");
    const target = join(tempDir, "dist", "captains-log");
    const configs = [];
    await buildCaptainsLogBrowserPackage(source, target, (config) => {
      configs.push(config);
      return Promise.resolve();
    });
    expect(configs).toEqual([{
      configFile: join(source, "vite.config.mjs"),
      logLevel: "silent",
      build: { outDir: join(target, "dist", "browser") },
    }]);
  });
});

describe("buildDirectory", () => {
  it("excludes test modules in every supported extension and non-distributable metadata", async () => {
    const source = join(tempDir, "source");
    await mkdir(source);
    for (const name of [".gitignore", "a.test.mjs", "b.spec.cjs", "c.test.js", "d.spec.ts", "types.d.ts"]) {
      await writeFile(join(source, name), "must not ship");
    }
    await writeFile(join(source, "runtime.ts"), 'export const value: number = 1;');
    const target = join(tempDir, "out");
    await buildDirectory(source, target);
    expect(await readdir(target)).toEqual(["runtime.js"]);
  });

  it("materializes a symlinked file as a real file", async () => {
    const source = join(tempDir, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "target.txt"), "linked content");
    await symlink(join(source, "target.txt"), join(source, "link.txt"));

    const target = join(tempDir, "out");
    await buildDirectory(source, target);

    await expect(readFile(join(target, "link.txt"), "utf8")).resolves.toBe("linked content");
    expect((await lstat(join(target, "link.txt"))).isSymbolicLink()).toBe(false);
  });

  it("materializes a symlinked directory as a real directory tree", async () => {
    const linkedDir = join(tempDir, "external-dir");
    await mkdir(linkedDir, { recursive: true });
    await writeFile(join(linkedDir, "nested.txt"), "nested content");

    const source = join(tempDir, "source");
    await mkdir(source, { recursive: true });
    await symlink(linkedDir, join(source, "link-dir"));

    const target = join(tempDir, "out");
    await buildDirectory(source, target);

    await expect(readFile(join(target, "link-dir", "nested.txt"), "utf8")).resolves.toBe("nested content");
    expect((await lstat(join(target, "link-dir"))).isSymbolicLink()).toBe(false);
  });

  it("fails the build on a broken symlink instead of silently dropping it", async () => {
    const source = join(tempDir, "source");
    await mkdir(source, { recursive: true });
    await symlink(join(tempDir, "does-not-exist.txt"), join(source, "broken.txt"));

    await expect(buildDirectory(source, join(tempDir, "out"))).rejects.toThrow();
  });

  it("guards against a symlinked directory cycling back into an ancestor", async () => {
    const source = join(tempDir, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "marker.txt"), "marker content");
    // A directory symlinking into itself (or any ancestor) previously made
    // buildDirectory recurse on an ever-lengthening synthetic path
    // (source/self/self/self/...) with no termination condition.
    await symlink(source, join(source, "self"));

    const target = join(tempDir, "out");
    await expect(buildDirectory(source, target)).resolves.toEqual({ copied: 1, transpiled: 0 });

    expect(await readdir(target)).toEqual(["marker.txt"]);
  });
});

describe("buildPiPackages", () => {
  it("retains symlinked package roots as materialized standalone package graphs", async () => {
    const source = join(tempDir, "packages");
    const external = join(tempDir, "external");
    await mkdir(source);
    await mkdir(join(external, "src"), { recursive: true });
    await writeFile(join(external, "package.json"), JSON.stringify({ name: "linked", type: "module" }));
    await writeFile(join(external, "tsconfig.json"), JSON.stringify({
      compilerOptions: { rootDir: "src", outDir: "dist" }, include: ["src/**/*.ts"],
    }));
    await writeFile(join(external, "src/index.ts"), "export const value: number = 1;");
    await symlink(external, join(source, "linked"), process.platform === "win32" ? "junction" : "dir");
    const target = join(tempDir, "out");
    await buildPiPackages(source, target);
    expect((await lstat(join(target, "linked"))).isSymbolicLink()).toBe(false);
    expect(await readFile(join(target, "linked/dist/index.js"), "utf8")).toContain("export const value = 1");
  });

  it("rebuilds a standalone src-to-dist graph without shipping stale output or tests", async () => {
    const source = join(tempDir, "packages");
    const packageDir = join(source, "example");
    await mkdir(join(packageDir, "src"), { recursive: true });
    await mkdir(join(packageDir, "dist"));
    await mkdir(join(packageDir, "test"));
    const manifest = { name: "example", type: "module", pi: { extensions: ["./dist/index.js"] } };
    await writeFile(join(packageDir, "package.json"), JSON.stringify(manifest));
    await writeFile(join(packageDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { rootDir: "src", outDir: "dist" }, include: ["src/**/*.ts"],
    }));
    await writeFile(join(packageDir, "src/index.ts"), 'import { value } from "./value.js"; export default value;');
    await writeFile(join(packageDir, "src/value.ts"), 'export const value: string = "fresh";');
    await writeFile(join(packageDir, "dist/index.js"), 'throw new Error("stale output");');
    await writeFile(join(packageDir, "dist/deleted.js"), 'throw new Error("deleted source");');
    await writeFile(join(packageDir, "test/index.test.mjs"), 'throw new Error("test source");');
    const target = join(tempDir, "out");
    await buildPiPackages(source, target);
    const output = join(target, "example");
    expect(await readdir(output)).toEqual(["dist", "package.json", "tsconfig.json"]);
    expect(await readdir(join(output, "dist"))).toEqual(["index.js", "value.js"]);
    expect(JSON.parse(await readFile(join(output, "package.json"), "utf8"))).toEqual(manifest);
    expect((await import(pathToFileURL(join(output, "dist/index.js")).href)).default).toBe("fresh");
  });

  it.each([".", "../outside"])("rejects standalone output escaping its package: %s", async (outDir) => {
    const source = join(tempDir, "packages");
    const packageDir = join(source, "example");
    await mkdir(join(packageDir, "src"), { recursive: true });
    await writeFile(join(packageDir, "src/index.ts"), "export {};");
    await writeFile(join(packageDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { rootDir: "src", outDir }, include: ["src/**/*.ts"], exclude: [],
    }));
    await expect(buildPiPackages(source, join(tempDir, "out"))).rejects.toThrow("Package build directory must be inside");
  });
});

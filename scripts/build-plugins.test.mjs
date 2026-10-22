import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDirectory, buildPiPackages, buildFilesBrowserPackage, buildCaptainsLogBrowserPackage, buildMermaidPackage, buildTerminalPackage, filesBrowserBuildConfig, findWatchDirs } from "./build-plugins.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let tempDir;

it("keeps each independently bundled plugin source in watcher coverage", async () => {
  const directories = await findWatchDirs(resolve("pi-web-plugins"));
  for (const id of ["files", "terminal", "mermaid"]) {
    expect(directories).toContain(await realpath(resolve("pi-web-plugins", id)));
  }
});

describe("Terminal package build boundary", () => {
  it("materializes only the server graph and browser bundle without shipping tests or private browser sources", async () => {
    const source = join(tempDir, "terminal");
    const target = join(tempDir, "out");
    await mkdir(join(source, "server"), { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(join(source, "server/server-plugin.ts"), 'import "./terminalService.js"; export default {};');
    await writeFile(join(source, "server/terminalService.ts"), "export const service = true;");
    await writeFile(join(source, "server/terminalService.test.ts"), "must not ship");
    await writeFile(join(source, "browserPrivate.ts"), "must not ship");
    const configs = [];
    await buildTerminalPackage(source, target, (config) => { configs.push(config); return Promise.resolve(); });
    expect((await readdir(target)).sort()).toEqual(["package.json", "server-plugin.js", "terminalService.js"]);
    expect(await readFile(join(target, "server-plugin.js"), "utf8")).toContain('./terminalService.js');
    expect(configs[0].base).toBe("./");
    expect(configs[0].build.outDir).toBe(join(target, "browser"));
    expect(configs[0].build.rollupOptions.external).toBeUndefined();
  });

  it("fails rather than falling back to legacy transpilation when the server graph is missing", async () => {
    const source = join(tempDir, "terminal");
    await mkdir(source);
    await writeFile(join(source, "package.json"), "{}");
    await expect(buildTerminalPackage(source, join(tempDir, "out"), () => Promise.resolve())).rejects.toThrow();
  });
});

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
  it("propagates an engine build failure rather than treating the renderer as a complete package", async () => {
    const source = join(tempDir, "mermaid");
    const target = join(tempDir, "out");
    await mkdir(source);
    await writeFile(join(source, "package.json"), JSON.stringify({ piWeb: { module: "browser/pi-web-plugin.js" } }));
    const failure = new Error("missing isolated Mermaid engine");
    await expect(buildMermaidPackage(source, target, (config) => {
      if (config.build.lib !== undefined) return Promise.reject(failure);
      return Promise.resolve();
    })).rejects.toBe(failure);
  });

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
    expect(configs[1].build.lib.entry).toBe(join(source, "mermaid-engine.ts"));
    expect(configs[1].build.lib.fileName()).toBe("mermaid-engine.js");
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
  it("ships optional Pi packages with compiled entry graphs and unchanged manifests without including test sources", async () => {
    const source = join(tempDir, "pi-packages");
    const packageDir = join(source, "captains-log");
    await mkdir(join(packageDir, "src"), { recursive: true });
    await mkdir(join(packageDir, "dist"));
    await mkdir(join(packageDir, "test"));
    const manifest = { name: "@chainingintention/pi-captains-log", type: "module", pi: { extensions: ["./dist/index.js"] } };
    await writeFile(join(packageDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist" }, include: ["src/**/*.ts"] }));
    await writeFile(join(packageDir, "dist/index.js"), 'throw new Error("stale output");');
    await writeFile(join(packageDir, "dist/deleted.js"), 'throw new Error("deleted source");');
    await writeFile(join(packageDir, "test/index.test.mjs"), 'throw new Error("tests must not ship");');
    await writeFile(join(packageDir, "package.json"), JSON.stringify(manifest));
    await writeFile(join(packageDir, "src/index.ts"), 'import { name } from "./name.js"; export default function register(): string { return name; }');
    await writeFile(join(packageDir, "src/name.ts"), 'export const name: string = "Captain’s Log";');
    await writeFile(join(packageDir, "src/index.test.ts"), 'throw new Error("tests must not ship");');
    await writeFile(join(packageDir, "src/types.d.ts"), 'export type Name = string;');

    const target = join(tempDir, "dist/pi-packages");
    await buildPiPackages(source, target);
    const output = join(target, "captains-log");
    expect(await recursiveFiles(output)).toEqual(["dist/index.js", "dist/name.js", "package.json", "tsconfig.json"]);
    expect(JSON.parse(await readFile(join(output, "package.json"), "utf8"))).toEqual(manifest);
    const compiled = await import(pathToFileURL(join(output, "dist/index.js")).href);
    expect(compiled.default()).toBe("Captain’s Log");
  });

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

describe("Files browser build configuration", () => {
  it("uses a fixed relative ES bundle layout without source maps", () => {
    const source = resolve("pi-web-plugins/files");
    const target = join(tempDir, "files");

    expect(filesBrowserBuildConfig(source, target)).toMatchObject({
      configFile: false,
      root: source,
      base: "./",
      publicDir: false,
      build: {
        outDir: join(target, "browser"),
        emptyOutDir: true,
        copyPublicDir: false,
        target: "es2022",
        minify: true,
        cssMinify: true,
        sourcemap: false,
        assetsInlineLimit: 0,
        rollupOptions: {
          input: join(source, "pi-web-plugin.ts"),
          preserveEntrySignatures: "strict",
          output: {
            format: "es",
            entryFileNames: "pi-web-plugin.js",
            chunkFileNames: "assets/[name]-[hash].js",
            assetFileNames: "assets/[name]-[hash][extname]",
          },
        },
      },
    });
  });

  it("keeps the dedicated Files source directory in plugin watch coverage", async () => {
    const watchDirectories = await findWatchDirs(resolve("pi-web-plugins"));
    expect(watchDirectories).toContain(resolve("pi-web-plugins/files"));
  });
});

it("removes stale readiness when a rebuild fails", async () => {
  await mkdir(join(tempDir, "scripts"));
  await copyFile(join(repoRoot, "scripts/build-plugins.mjs"), join(tempDir, "scripts/build-plugins.mjs"));
  await symlink(join(repoRoot, "node_modules"), join(tempDir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  // Empty special-plugin directories reach the missing Files manifest before any bundle work.
  for (const plugin of ["files", "terminal", "mermaid", "code-highlight"]) {
    await mkdir(join(tempDir, "pi-web-plugins", plugin), { recursive: true });
  }
  const readyPath = join(tempDir, "dist/.plugins-ready");
  await mkdir(dirname(readyPath), { recursive: true });
  await writeFile(readyPath, "ready\n");
  await expect(execUtf8(process.execPath, ["scripts/build-plugins.mjs"], tempDir, 30_000)).rejects.toThrow(/files[/\\]package\.json/u);
  await expect(readFile(readyPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

function execUtf8(file, args, cwd, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs }, (error, stdout) => {
      if (error !== null) {
        reject(error instanceof Error ? error : new Error("Command failed"));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

async function recursiveFiles(root, base = root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await recursiveFiles(path, base));
    else if (entry.isFile()) files.push(relative(base, path).split(sep).join("/"));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

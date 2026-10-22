import { mkdtemp, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.resetModules(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function sdkPackage() {
  const directory = await mkdtemp(join(tmpdir(), "pi-runtime-package-info-"));
  directories.push(directory);
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.3.0" }));
  return directory;
}

it("returns the cached selected host identity without reselecting another SDK", async () => {
  vi.resetModules();
  const directory = await sdkPackage();
  vi.stubEnv("PI_WEB_PI_PACKAGE_DIR", directory);
  const { piRuntimePackageInfo } = await import("./piRuntime.js");
  expect(await piRuntimePackageInfo()).toEqual({ directory, version: "1.3.0" });
  const other = await sdkPackage();
  vi.stubEnv("PI_WEB_PI_PACKAGE_DIR", other);
  expect(await piRuntimePackageInfo()).toEqual({ directory, version: "1.3.0" });
});

it.each(["name", "version"])("rejects a changed selected package %s instead of falling back", async (field) => {
  vi.resetModules();
  const directory = await sdkPackage();
  vi.stubEnv("PI_WEB_PI_PACKAGE_DIR", directory);
  const { piRuntimePackageInfo } = await import("./piRuntime.js");
  await piRuntimePackageInfo();
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.3.0", [field]: 42 }));
  await expect(piRuntimePackageInfo()).rejects.toThrow("invalid package identity");
});

it("keeps SDK imports and adapter identity pinned when the host installation symlink is retargeted", async () => {
  vi.resetModules();
  const first = await sdkPackage();
  const second = await sdkPackage();
  for (const [directory, marker] of [[first, "first"], [second, "second"]]) {
    if (directory === undefined) throw new Error("Missing fixture directory");
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.3.0", type: "module", exports: "./index.js" }));
    await writeFile(join(directory, "index.js"), `export const marker = ${JSON.stringify(marker)};`);
  }
  const aliases = await mkdtemp(join(tmpdir(), "pi-runtime-alias-"));
  directories.push(aliases);
  const alias = join(aliases, "host");
  await symlink(first, alias, process.platform === "win32" ? "junction" : "dir");
  vi.stubEnv("PI_WEB_PI_PACKAGE_DIR", alias);
  const runtime = await import("./piRuntime.js");
  expect(await runtime.loadPiSdk()).toMatchObject({ marker: "first" });
  await unlink(alias);
  await symlink(second, alias, process.platform === "win32" ? "junction" : "dir");
  expect(await realpath(alias)).toBe(await realpath(second));
  expect(await runtime.piRuntimePackageInfo()).toEqual({ directory: await realpath(first), version: "1.3.0" });
  expect(await runtime.loadPiSdk()).toMatchObject({ marker: "first" });
});

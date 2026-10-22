import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("loads the built Workflows server in isolation without a second installed host package", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-workflows-artifact-"));
  try {
    const isolated = join(directory, "server-plugin.mjs");
    await copyFile(resolve("dist/pi-packages/workflows/server-plugin.js"), isolated);
    const plugin = (await import(pathToFileURL(isolated).href)).default;
    expect(plugin.requires).toEqual([
      expect.objectContaining({ pluginId: "pi-web.host", id: "catalog", version: 1 }),
      expect.objectContaining({ pluginId: "pi-web.host", id: "pi-sessions", version: 1 }),
    ]);
    expect(plugin.activate).toBeTypeOf("function");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

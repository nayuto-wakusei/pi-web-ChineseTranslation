import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { buildMermaidEngine } from "./build-plugins.mjs";

it("bundles Mermaid and DOMPurify as one package-local sandbox engine", async () => {
  const build = vi.fn(async () => undefined);
  await buildMermaidEngine("source/mermaid", "output/mermaid", build);
  expect(build).toHaveBeenCalledWith(expect.objectContaining({
    configFile: false,
    publicDir: false,
    build: expect.objectContaining({
      outDir: "output/mermaid",
      emptyOutDir: false,
      lib: expect.objectContaining({ entry: resolve("source/mermaid/mermaid-engine.ts"), formats: ["iife"] }),
    }),
  }));
  expect(build.mock.calls[0][0].build.lib.fileName()).toBe("mermaid-engine.js");
});

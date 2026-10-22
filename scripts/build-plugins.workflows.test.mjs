import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { buildWorkflowsServerPackage } from "./build-plugins.mjs";

it("bundles the Workflows server against the checkout public API without rebuilding other packages", async () => {
  const build = vi.fn(() => Promise.resolve());
  const source = resolve("pi-packages/workflows");
  const output = resolve("isolated-output/workflows");
  await buildWorkflowsServerPackage(source, output, build);
  expect(build).toHaveBeenCalledExactlyOnceWith({
    configFile: resolve(source, "vite.config.mjs"), logLevel: "silent",
    resolve: { alias: { "@chainingintention/pi-web-cn/server-plugin-api": resolve("src/server-plugin-api.ts") } },
    build: { outDir: output },
  });
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

const baseline = process.env["PI_WEB_PERFORMANCE_REF"];
const repository = fileURLToPath(new URL("../..", import.meta.url));
const snapshotPaths = baseline === undefined ? undefined : new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", baseline, "--", "src"], { cwd: repository, encoding: "utf8" }).trim().split(/\r?\n/u));

export default defineConfig({
  plugins: baseline === undefined ? [] : [{
    name: "performance-source-snapshot",
    enforce: "pre",
    load(id) {
      const path = relative(repository, id.split("?")[0] ?? id).replaceAll("\\", "/");
      if (!path.startsWith("src/") || snapshotPaths?.has(path) !== true || !/\.(?:ts|css)$/u.test(path)) return;
      return execFileSync("git", ["show", `${baseline}:${path}`], { cwd: resolve(repository), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    },
  }],
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: {
    assetsInlineLimit: 0,
    outDir: fileURLToPath(new URL("../../node_modules/.cache/pi-web/performance-fixture", import.meta.url)),
    emptyOutDir: true,
    rolldownOptions: { input: fileURLToPath(new URL("performance.html", import.meta.url)) },
  },
});

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { developmentBuildDirectory, startDevelopmentProcess, superviseDevelopmentProcesses } from "./dev-processes.mjs";

const require = createRequire(import.meta.url);
const viteCli = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");

export function runDevelopmentClient(args, { env = process.env, launch = startDevelopmentProcess, signals = process, stop } = {}) {
  const cwd = developmentBuildDirectory(env);
  return superviseDevelopmentProcesses((add) => {
    add(launch(viteCli, args, env, cwd === undefined ? undefined : { cwd }));
  }, { signals, ...(stop === undefined ? {} : { stop }) });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runDevelopmentClient(process.argv.slice(2));
}

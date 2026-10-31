import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { developmentBuildDirectory, developmentRuntimeEnvironment, startDevelopmentProcess, superviseDevelopmentProcesses } from "./dev-processes.mjs";

const require = createRequire(import.meta.url);

export function runDevelopmentWeb({ env = process.env, launch = startDevelopmentProcess, signals = process, stop } = {}) {
  // Refresh plugin UI against the running backend during development only.
  const childEnv = { ...env, PI_WEB_DEV_PLUGIN_PAIRING: env.PI_WEB_DEV_PLUGIN_PAIRING ?? "1" };
  const buildCwd = developmentBuildDirectory(env);
  // Only the builder changes cwd. Runtime imports and package registrations
  // stay anchored to the production-compatible installation path.
  return superviseDevelopmentProcesses((add, stopped) => {
    const builder = add(launch(resolve("scripts/build-plugins.mjs"), ["--watch"], childEnv, { ipc: true, ...(buildCwd === undefined ? {} : { cwd: buildCwd }) }));
    let apiStarted = false;
    builder.on("message", (message) => {
      if (stopped() || apiStarted || message?.type !== "plugin-build-ready") return;
      apiStarted = true;
      add(launch(require.resolve("tsx/cli"), ["watch", "src/server/index.ts"], developmentRuntimeEnvironment(childEnv)));
    });
  }, { signals, ...(stop === undefined ? {} : { stop }) });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runDevelopmentWeb();
}

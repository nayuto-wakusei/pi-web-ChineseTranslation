import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startDevelopmentProcess, superviseDevelopmentProcesses } from "./dev-processes.mjs";

/** npm owns each service's pre/main/post hooks; this owner only supervises the group. */
export function runDevelopmentServices(scripts, { env = process.env, launch = startDevelopmentProcess, signals = process, stop } = {}) {
  if (scripts.length === 0) throw new Error("At least one development npm script is required.");
  const npmCli = env.npm_execpath;
  if (!npmCli) throw new Error("Start development services through npm run so their lifecycle hooks are available.");
  const childEnv = { ...env, PI_WEB_DEV_SUPERVISED: "1" };
  return superviseDevelopmentProcesses((add) => {
    for (const script of scripts) add(launch(npmCli, ["run", script], childEnv));
  }, { signals, ...(stop === undefined ? {} : { stop }) });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runDevelopmentServices(process.argv.slice(2));
}

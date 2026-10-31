import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const detachedChildren = new WeakSet();

/** Browser tooling must build outside the npm installation's node_modules path. */
export function developmentBuildDirectory(env) {
  return env.PI_WEB_DOCKER_MODE === "dev" ? "/build/pi-web" : undefined;
}

/** Runtime Node stays selected by execPath; user tools retain their original PATH. */
export function developmentRuntimeEnvironment(env) {
  const runtimeEnv = { ...env };
  if (runtimeEnv.PI_WEB_SERVICE_ORIGINAL_PATH !== undefined) {
    runtimeEnv.PATH = runtimeEnv.PI_WEB_SERVICE_ORIGINAL_PATH;
    delete runtimeEnv.PI_WEB_SERVICE_ORIGINAL_PATH;
  }
  delete runtimeEnv.PI_WEB_DEV_SUPERVISED;
  return runtimeEnv;
}

/** Only the outer owner creates groups; nested watchers/runtimes stay in their lifecycle group. */
export function startDevelopmentProcess(entry, args, env, { ipc = false, execArgv = [], cwd } = {}) {
  const detached = process.platform !== "win32" && process.env.PI_WEB_DEV_SUPERVISED !== "1";
  const child = spawn(process.execPath, [...execArgv, entry, ...args], {
    env,
    cwd,
    detached,
    stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
  });
  if (detached) detachedChildren.add(child);
  return child;
}

export function stopDevelopmentProcess(child, signal = "SIGTERM") {
  if (child.pid === undefined) return;
  try {
    // A group can outlive npm/the shell. Keep owning it after its leader exits.
    if (detachedChildren.has(child)) process.kill(-child.pid, signal);
    else if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function processGroupIsAlive(child) {
  if (!detachedChildren.has(child) || child.pid === undefined) return false;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForDevelopmentProcess(child) {
  if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => child.once("exit", resolve));
  }
  // npm may exit before a nested supervisor finishes its runtime cleanup.
  while (processGroupIsAlive(child)) await delay(20);
}

/** An exited builder or API must not leave the other half running and appearing healthy. */
export async function superviseDevelopmentProcesses(start, { signals = process, stop = stopDevelopmentProcess } = {}) {
  const children = new Set();
  let finished = false;
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  const finishWith = (code) => {
    if (finished) return;
    finished = true;
    finish(code);
  };
  const add = (child) => {
    children.add(child);
    child.once("error", (error) => { console.error(error); finishWith(1); });
    child.once("exit", (code, signal) => {
      finishWith(code ?? (signal === "SIGINT" ? 130 : 1));
    });
    return child;
  };
  const onInterrupt = () => finishWith(130);
  const onTerminate = () => finishWith(143);
  signals.on("SIGINT", onInterrupt);
  signals.on("SIGTERM", onTerminate);
  try {
    await start(add, () => finished);
    return await completed;
  } finally {
    try {
      const pending = [...children].filter(child =>
        (child.exitCode === null && child.signalCode === null) || processGroupIsAlive(child));
      for (const child of pending) stop(child);
      if (pending.length > 0) {
        const force = setTimeout(() => { for (const child of pending) stop(child, "SIGKILL"); }, 30_000);
        try {
          await Promise.all(pending.map(waitForDevelopmentProcess));
        } finally { clearTimeout(force); }
      }
    } finally {
      // npm and the outer process group may both forward the shutdown signal.
      signals.removeListener("SIGINT", onInterrupt);
      signals.removeListener("SIGTERM", onTerminate);
    }
  }
}

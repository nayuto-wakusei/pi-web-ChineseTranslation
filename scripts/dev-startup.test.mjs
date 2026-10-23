import { EventEmitter } from "node:events";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { runDevelopmentWeb } from "./dev-web.mjs";
import { runDevelopmentSessiond, waitForPluginBuild } from "./dev-sessiond.mjs";

function harness() {
  const signals = new EventEmitter();
  const children = [];
  const launch = vi.fn(() => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.finish = (code) => { child.exitCode = code; child.emit("exit", code, null); };
    children.push(child);
    return child;
  });
  const stop = vi.fn(child => child.finish(0));
  return { signals, children, launch, stop, env: {} };
}

it("starts one builder, waits for publication, then starts the API without rebuilding", async () => {
  const options = harness();
  const running = runDevelopmentWeb(options);
  expect(options.launch).toHaveBeenCalledTimes(1);
  const builder = options.children[0];
  expect(options.launch.mock.calls[0][1]).toEqual(["--watch"]);
  builder.emit("message", { type: "plugin-build-ready" });
  builder.emit("message", { type: "plugin-build-ready" });
  expect(options.launch).toHaveBeenCalledTimes(2);
  expect(options.launch.mock.calls[1][1]).toEqual(["watch", "src/server/index.ts"]);
  builder.finish(1);
  expect(await running).toBe(1);
  expect(options.stop).toHaveBeenCalledWith(options.children[1]);
});

it("does not start the API when the initial build fails", async () => {
  const options = harness();
  const running = runDevelopmentWeb(options);
  options.children[0].finish(1);
  expect(await running).toBe(1);
  expect(options.launch).toHaveBeenCalledTimes(1);
});

it("stops the builder when the API exits or the web owner is stopped", async () => {
  const options = harness();
  const running = runDevelopmentWeb(options);
  options.children[0].emit("message", { type: "plugin-build-ready" });
  options.children[1].finish(1);
  expect(await running).toBe(1);
  expect(options.stop).toHaveBeenCalledWith(options.children[0]);
  const stopped = harness();
  const stopping = runDevelopmentWeb(stopped);
  stopped.signals.emit("SIGTERM");
  expect(await stopping).toBe(143);
  expect(stopped.stop).toHaveBeenCalledWith(stopped.children[0]);
});

it("starts sessiond only after build readiness without starting another builder", async () => {
  const options = harness();
  let publish;
  const wait = vi.fn(() => new Promise(resolve => { publish = resolve; }));
  const running = runDevelopmentSessiond({ ...options, wait });
  expect(options.launch).not.toHaveBeenCalled();
  publish();
  await vi.waitFor(() => expect(options.launch).toHaveBeenCalledOnce());
  expect(options.launch.mock.calls[0][0]).toBe("src/server/sessiond.ts");
  expect(options.launch.mock.calls[0][1]).toEqual([]);
  expect(options.launch.mock.calls[0][4][0]).toBe("--import");
  expect(new URL(options.launch.mock.calls[0][4][1]).protocol).toBe("file:");
  expect(options.launch.mock.calls[0][2]).toEqual(options.env);
  options.children[0].finish(0);
  expect(await running).toBe(0);
});

it("does not launch sessiond if stopped while readiness is resolving", async () => {
  const options = harness();
  let publish;
  const running = runDevelopmentSessiond({ ...options, wait: () => new Promise(resolve => { publish = resolve; }) });
  options.signals.emit("SIGTERM");
  publish();
  await expect(running).rejects.toMatchObject({ name: "AbortError" });
  expect(options.launch).not.toHaveBeenCalled();
});

it("waits for the cold-start marker and reports a missing builder", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-dev-start-"));
  try {
    await expect(waitForPluginBuild({ cwd, timeoutMs: 0 })).rejects.toThrow("Plugin build not ready");
    const waiting = waitForPluginBuild({ cwd, intervalMs: 1, timeoutMs: 5_000 });
    await mkdir(join(cwd, "dist"));
    await writeFile(join(cwd, "dist", ".plugins-ready"), "ready");
    await waiting;
    const controller = new AbortController();
    controller.abort();
    await expect(waitForPluginBuild({ cwd, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

it("does not start sessiond after a readiness failure", async () => {
  const options = harness();
  await expect(runDevelopmentSessiond({ ...options, wait: () => Promise.reject(new Error("no build")) })).rejects.toThrow("no build");
  expect(options.launch).not.toHaveBeenCalled();
  expect(options.signals.listenerCount("SIGTERM")).toBe(0);
});

it("removes stale readiness and exits when the real initial build fails", { timeout: 15_000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-dev-builder-"));
  let child;
  try {
    await mkdir(join(cwd, "pi-web-plugins"));
    await writeTerminalBuildFixture(cwd);
    await writeRequiredBrowserBuildFixtures(cwd);
    await mkdir(join(cwd, "dist"));
    await writeFile(join(cwd, "dist", ".plugins-ready"), "stale");
    await writeFile(join(cwd, "pi-web-plugins", "broken.ts"), "export const = ;");
    child = fork(fileURLToPath(new URL("./build-plugins.mjs", import.meta.url)), ["--watch"], { cwd, execArgv: [], stdio: "ignore" });
    const messages = [];
    child.on("message", (message) => { messages.push(message); });
    const [code] = await once(child, "exit");
    expect(code).toBe(1);
    expect(messages).toEqual([]);
    await expect(readFile(join(cwd, "dist", ".plugins-ready"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
    await rm(cwd, { recursive: true, force: true });
  }
});

it("publishes real builds and recovers from a later failure without stopping the watcher", { timeout: 15_000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-dev-builder-"));
  let child;
  try {
    await mkdir(join(cwd, "pi-web-plugins"));
    await writeTerminalBuildFixture(cwd);
    await writeRequiredBrowserBuildFixtures(cwd);
    const source = join(cwd, "pi-web-plugins", "entry.ts");
    await writeFile(source, "export const value = 1;");
    child = fork(fileURLToPath(new URL("./build-plugins.mjs", import.meta.url)), ["--watch"], { cwd, execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let diagnostics = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { diagnostics += chunk; });
    expect(await waitForBuildPublication(child, () => diagnostics)).toEqual({ type: "plugin-build-ready" });
    await expect(readFile(join(cwd, "dist", ".plugins-ready"), "utf8")).resolves.toBe("ready\n");
    await writeFile(source, "export const = ;");
    await vi.waitFor(async () => {
      await expect(readFile(join(cwd, "dist", ".plugins-ready"))).rejects.toMatchObject({ code: "ENOENT" });
    });
    expect(child.exitCode).toBeNull();
    const rebuilt = waitForBuildPublication(child, () => diagnostics);
    await writeFile(source, "export const value = 2;");
    expect(await rebuilt).toEqual({ type: "plugin-build-ready" });
    await expect(readFile(join(cwd, "dist", ".plugins-ready"), "utf8")).resolves.toBe("ready\n");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
    await rm(cwd, { recursive: true, force: true });
  }
});

function waitForBuildPublication(child, diagnostics) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off("message", published);
      child.off("exit", exited);
      child.off("error", failed);
    };
    const published = (message) => { cleanup(); resolve(message); };
    const exited = (code, signal) => {
      cleanup();
      reject(new Error(`Builder exited before publication (${code ?? signal}): ${diagnostics()}`));
    };
    const failed = (error) => { cleanup(); reject(error); };
    child.once("message", published);
    child.once("exit", exited);
    child.once("error", failed);
  });
}

async function writeTerminalBuildFixture(cwd) {
  const terminalRoot = join(cwd, "pi-web-plugins", "terminal");
  await mkdir(join(terminalRoot, "server"), { recursive: true });
  await writeFile(join(terminalRoot, "package.json"), JSON.stringify({ type: "module", piWeb: { plugins: [{ id: "pi-web.terminal", browserRoot: "browser", module: "browser/pi-web-plugin.js", serverModule: "server-plugin.js", machineSpecific: true }] } }));
  await writeFile(join(terminalRoot, "server", "server-plugin.ts"), "export default { apiVersion: 3, activate: () => ({ contributions: {} }) };");
  await writeFile(join(terminalRoot, "pi-web-plugin.ts"), "export default { apiVersion: 4, activate: () => ({ contributions: {} }) };");
}

async function writeRequiredBrowserBuildFixtures(cwd) {
  for (const id of ["files", "mermaid", "code-highlight"]) {
    const root = join(cwd, "pi-web-plugins", id);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(join(root, "pi-web-plugin.ts"), "export default { apiVersion: 4, activate: () => ({ contributions: {} }) };");
    if (id === "mermaid") await writeFile(join(root, "mermaid-engine.ts"), "globalThis.fixtureMermaidEngine = true;");
  }
  for (const id of ["captains-log", "workflows"]) {
    const packageRoot = join(cwd, "pi-packages", id);
    const entry = id === "captains-log" ? "pi-web-plugin" : "server-plugin";
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(join(packageRoot, `${entry}.ts`), `export default { apiVersion: ${id === "captains-log" ? 4 : 3}, activate: () => ({ contributions: {} }) };`);
    await writeFile(join(packageRoot, "vite.config.mjs"), `import { fileURLToPath } from "node:url";
export default { build: { lib: { entry: fileURLToPath(new URL("./${entry}.ts", import.meta.url)), formats: ["es"], fileName: () => "${entry}.js" } } };
`);
  }
}

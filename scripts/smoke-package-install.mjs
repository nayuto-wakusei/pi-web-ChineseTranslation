import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { smokeInstalledServices } from "./smoke-installed-services.mjs";

const NPM_VERSION = "12.0.1";
const MARKER = "pi-web-package-pty-ok";
const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
if (typeof packageManifest.name !== "string" || packageManifest.name === "") {
  throw new Error("package.json must define a package name");
}

if (process.platform === "win32") {
  throw new Error("The installed-package PTY smoke test requires a POSIX shell");
}

const npmExecPath = process.env["npm_execpath"];
if (npmExecPath === undefined || npmExecPath === "") {
  throw new Error("npm_execpath is required; run this check through `npm run smoke:package-install`");
}

const root = await mkdtemp(join(tmpdir(), "pi-web-package-install-"));
try {
  const packDir = join(root, "pack");
  const npmToolDir = join(root, "npm-tool");
  const globalPrefix = join(root, "global");
  await Promise.all([
    mkdir(packDir, { recursive: true }),
    mkdir(join(globalPrefix, "lib"), { recursive: true }),
    mkdir(npmToolDir, { recursive: true }),
  ]);
  await writeFile(join(npmToolDir, "package.json"), '{"private":true}\n');

  const packOutput = await runNpm(npmExecPath, ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir], repoRoot);
  const tarballPath = join(packDir, packageTarballFilename(packOutput));

  await runNpm(npmExecPath, [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--no-save",
    `npm@${NPM_VERSION}`,
  ], npmToolDir);
  const npm12ExecPath = join(npmToolDir, "node_modules", "npm", "bin", "npm-cli.js");

  await runNpm(npm12ExecPath, [
    "install",
    "--global",
    tarballPath,
    "--prefix",
    globalPrefix,
    "--allow-scripts=node-pty",
    "--no-audit",
    "--no-fund",
  ], root);

  const packageRoot = join(globalPrefix, "lib", "node_modules", ...packageManifest.name.split("/"));
  await smokeInstalledServices(packageRoot);
  await smokeInstalledTerminalService(packageRoot);
  console.log(`Installed-package web, daemon, and PTY smoke tests passed with npm ${NPM_VERSION}.`);
} finally {
  await rm(root, { recursive: true, force: true });
}

async function runNpm(npmCliPath, args, cwd) {
  const result = await execFileAsync(process.execPath, [npmCliPath, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 180_000,
  });
  return result.stdout;
}

function packageTarballFilename(output) {
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0]?.filename !== "string") {
    throw new Error("npm pack returned an unexpected result");
  }
  return parsed[0].filename;
}

async function smokeInstalledTerminalService(packageRoot) {
  const requireFromPackage = createRequire(join(packageRoot, "package.json"));
  const nodePtyPackageJsonPath = requireFromPackage.resolve("node-pty/package.json");
  const nodePtyPackage = JSON.parse(await readFile(nodePtyPackageJsonPath, "utf8"));
  if (typeof nodePtyPackage.version !== "string" || nodePtyPackage.version.includes("-")) {
    throw new Error(`Installed package resolved a non-stable node-pty version: ${String(nodePtyPackage.version)}`);
  }

  const terminalModuleUrl = pathToFileURL(join(packageRoot, "dist", "pi-web-plugins", "terminal", "server-plugin.js")).href;
  const { default: plugin } = await import(terminalModuleUrl);
  if (plugin?.apiVersion !== 3 || typeof plugin.activate !== "function") {
    throw new Error("Installed Terminal server bundle did not export the plugin API v3 entry");
  }
  const previousShell = process.env["SHELL"];
  const previousCommandShell = process.env["PI_WEB_COMMAND_SHELL"];
  process.env["SHELL"] = "/bin/sh";
  process.env["PI_WEB_COMMAND_SHELL"] = "/bin/sh";
  const controller = new AbortController();
  const dataDirectory = await mkdtemp(join(tmpdir(), "pi-web-installed-terminal-"));
  let activation;
  const channels = [];
  try {
    activation = await plugin.activate({
      apiVersion: 3,
      pluginId: "pi-web.terminal",
      packageRoot: join(packageRoot, "dist", "pi-web-plugins", "terminal"),
      dataDirectory,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      notices: { version: 1, record() {} },
      settings: {},
      execFile: () => Promise.reject(new Error("Installed Terminal smoke does not use the host exec bridge")),
      signal: controller.signal,
      lifetimeSignal: controller.signal,
    });
    const peer = activation?.peer;
    if (typeof peer?.request !== "function" || typeof peer?.openChannel !== "function") {
      throw new Error("Installed Terminal did not provide both request and channel operations");
    }
    const provision = activation.provides?.find(({ capability }) => capability.pluginId === "pi-web.terminal"
      && capability.id === "service" && capability.version === 1);
    if (provision === undefined) throw new Error("Installed Terminal did not publish the required service capability");
    const service = provision.capability.parse(provision.value);
    const activity = [];
    const removed = [];
    service.bindActivitySink({
      updateTerminal: (terminal) => { activity.push({ ...terminal }); },
      removeTerminal: (terminalId) => { removed.push(terminalId); },
    });
    const project = { id: "package-smoke", name: "Package smoke", path: packageRoot };
    const workspace = { id: "package-smoke", projectId: project.id, path: packageRoot, label: "Package smoke", isMain: true };
    const request = (operation, input, target = workspace) => peer.request({
      project, workspace: target, operation, input, signal: controller.signal,
    });
    const run = await request("terminal.run", {
      origin: "package-smoke", title: "Installed package PTY smoke test",
      command: `printf '%s' '${MARKER}'`,
      cwd: "/browser-must-not-control-cwd",
    });
    if (typeof run?.terminalId !== "string" || typeof run.id !== "string") {
      throw new Error("Installed Terminal returned an invalid command run");
    }
    const output = await readTerminalChannel(peer, project, workspace, run.terminalId, channels, controller.signal);
    if (!output.includes(MARKER)) throw new Error(`Installed PTY output did not contain ${MARKER}: ${JSON.stringify(output)}`);
    const completed = await request("terminal.get-run", { runId: run.id });
    if (completed?.status !== "succeeded" || completed.exitCode !== 0) {
      throw new Error(`Installed Terminal command did not succeed: ${JSON.stringify(completed)}`);
    }
    if (!activity.some((terminal) => terminal.id === run.terminalId && terminal.exited === true)) {
      throw new Error("Installed Terminal service capability did not report command completion activity");
    }
    const otherWorkspace = { ...workspace, id: "other-workspace" };
    if (await request("terminal.get-run", { runId: run.id }, otherWorkspace) !== null) {
      throw new Error("Installed Terminal leaked a learned command id to another workspace");
    }
    const replay = [];
    const replayChannel = await peer.openChannel({
      project, workspace, operation: "terminal.attach", input: { terminalId: run.terminalId },
      signal: controller.signal, send: (frame) => { replay.push(frame); },
    });
    channels.push(replayChannel);
    if (!replay.some((frame) => frame.type === "output" && frame.replay === true && frame.data.includes(MARKER))) {
      throw new Error("Installed Terminal did not replay completed PTY output");
    }
    const interactive = await request("terminal.create", { name: "Installed interactive shell", cols: 100, rows: 30 });
    await readTerminalChannel(peer, project, workspace, interactive.id, channels, controller.signal, (channel) => {
      channel.receive({ type: "resize", cols: 120, rows: 40 }, controller.signal);
      channel.receive({ type: "input", data: `printf '%s' '${MARKER}-input'\nexit\n` }, controller.signal);
    }).then((interactiveOutput) => {
      if (!interactiveOutput.includes(`${MARKER}-input`)) throw new Error("Installed Terminal channel input did not reach the native PTY");
    });
    await request("terminal.close", { terminalId: run.terminalId });
    await replayChannel.closed;
    await request("terminal.close", { terminalId: interactive.id });
    if (!removed.includes(run.terminalId) || !removed.includes(interactive.id)) {
      throw new Error("Installed Terminal service capability did not report removed terminal activity");
    }
    console.log("Installed independent Terminal plugin request, channel, replay, workspace scope, and native PTY passed.");
  } finally {
    controller.abort(new Error("Installed Terminal smoke completed"));
    for (const channel of channels) await channel.close?.({ code: 1000, reason: "smoke complete", signal: new AbortController().signal });
    await activation?.dispose?.(new AbortController().signal);
    await rm(dataDirectory, { recursive: true, force: true });
    if (previousShell === undefined) delete process.env["SHELL"];
    else process.env["SHELL"] = previousShell;
    if (previousCommandShell === undefined) delete process.env["PI_WEB_COMMAND_SHELL"];
    else process.env["PI_WEB_COMMAND_SHELL"] = previousCommandShell;
  }
}

async function readTerminalChannel(peer, project, workspace, terminalId, channels, signal, onOpen) {
  let output = "";
  let settle;
  let fail;
  const completed = new Promise((resolvePromise, reject) => { settle = resolvePromise; fail = reject; });
  const timeout = setTimeout(() => { fail(new Error(`Timed out waiting for installed Terminal output: ${JSON.stringify(output)}`)); }, 10_000);
  try {
    const channel = await peer.openChannel({
      project, workspace, operation: "terminal.attach", input: { terminalId, cols: 100, rows: 30 }, signal,
      send(frame) {
        if (frame.type === "output") output += frame.data;
        if (frame.type === "exit") {
          if (frame.exitCode === 0) settle();
          else fail(new Error(`Installed PTY command exited with ${String(frame.exitCode)}`));
        }
      },
    });
    channels.push(channel);
    await onOpen?.(channel);
    await completed;
    return output;
  } finally {
    clearTimeout(timeout);
  }
}

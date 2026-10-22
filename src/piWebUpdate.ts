import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { isatty } from "node:tty";
import { promisify } from "node:util";
import { effectivePiWebConfig, isHostAbsoluteAgentDir, PI_CODING_AGENT_DIR_ENV } from "./config.js";
import { detectPiWebInstallation } from "./server/piWebStatus.js";
import { SessionDaemonClient } from "./sessiond/sessionDaemonClient.js";
import type { PiWebInstallationInfo } from "./shared/apiTypes.js";
import { nativeServiceManagerRefs } from "./nativeServices/servicePlan.js";
import { piRuntimeCliPath } from "./piRuntime.js";
import { loadNodeTranslator } from "./localization.js";
import { createTranslator, type Translator } from "./shared/i18n.js";

const selectedPiCliPath = await piRuntimeCliPath();

const PACKAGE_NAME = "@chainingintention/pi-web-cn";
const INTERNAL_NPM_VERSION = "PI_WEB_INTERNAL_NPM_UPDATE_VERSION";
const INTERNAL_UPDATE_PROFILE = "PI_WEB_INTERNAL_UPDATE_PROFILE";
const INTERNAL_UPDATE_INSTALLATION = "PI_WEB_INTERNAL_UPDATE_INSTALLATION";
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const UPDATE_HANDOFF_LABEL_PREFIX = "com.pi-web.update";
const WARNING = "Updating PI WEB will restart services and interrupt active sessions and terminals, including this terminal.";
const HELP = "Usage: pi-web update [--yes] [--force]\n--force reinstalls an npm-global installation even when already current. Without --yes, an interactive confirmation is required. Nested Linux updates use a detached systemd user service. Nested macOS updates use a detached launchd user agent.";

export interface PiWebUpdateCommand {
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

interface LaunchdUpdateHandoff {
  domain: string;
  label: string;
  target: string;
  plistPath: string;
  logPath: string;
  plist: string;
  environment: NodeJS.ProcessEnv;
}

/** All process, profile, filesystem, and confirmation effects are replaceable in tests. */
export interface PiWebUpdateDependencies {
  translator?: Translator;
  env: NodeJS.ProcessEnv;
  nodeExecutable: string;
  platform: NodeJS.Platform;
  home: string;
  userId: number;
  cwd: string;
  uniqueId(): string;
  exists(path: string): boolean;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
  readFile(path: string): Promise<string>;
  removeFile(path: string): Promise<void>;
  piCliPath: string;
  interactive: boolean;
  agentDir(): Promise<string>;
  detectInstallation(agentDir: string): Promise<PiWebInstallationInfo>;
  realpath(path: string): Promise<string>;
  capture(command: PiWebUpdateCommand): Promise<string>;
  run(command: PiWebUpdateCommand): Promise<void>;
  confirm(message: string): Promise<boolean>;
  log(message: string): void;
}

function defaultDependencies(): PiWebUpdateDependencies {
  const translator = loadNodeTranslator("cli");
  return {
    translator,
    env: { ...process.env },
    nodeExecutable: process.execPath,
    platform: process.platform,
    home: homedir(),
    userId: userInfo().uid,
    cwd: process.cwd(),
    uniqueId: randomUUID,
    exists: existsSync,
    mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    writeFile: (path, contents) => writeFile(path, contents, { encoding: "utf8", mode: 0o600 }),
    removeFile: (path) => rm(path, { force: true }),
    readFile: (path) => readFile(path, "utf8"),
    // Use the selected package's declared CLI, not a different pi on PATH.
    piCliPath: selectedPiCliPath,
    interactive: isatty(0) && isatty(1),
    async agentDir() {
      const active = await new SessionDaemonClient().getActiveAgentProfile();
      if (active.status === "available") return active.profile.dir;
      if (active.status === "invalid") throw new Error(translator("update.profileInvalid", "Cannot safely resolve the active Pi profile: {error}", { error: active.error }));
      return effectivePiWebConfig().config.agent.dir;
    },
    detectInstallation: detectPiWebInstallation,
    realpath,
    async capture(command) {
      const result = await promisify(execFile)(command.executable, command.args, { env: command.env, encoding: "utf8" });
      return result.stdout.trim();
    },
    run(command) {
      return new Promise<void>((resolveRun, reject) => {
        const child = spawn(command.executable, command.args, { env: command.env, stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          if (code === 0) resolveRun();
          else reject(new Error(translator("update.commandFailed", "{command} failed ({result}); no further update/restart steps were run.", { command: command.executable, result: signal ?? `exit ${String(code)}` })));
        });
      });
    },
    async confirm(message) {
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return /^(y|yes)$/i.test((await input.question(`${message} [y/N] `)).trim());
      } finally {
        input.close();
      }
    },
    log: console.log,
  };
}

/** CLI arguments exclude `update`. Throws on invalid/unsafe requests and failed commands. */
export async function runPiWebUpdate(args: readonly string[], injected?: PiWebUpdateDependencies): Promise<void> {
  const help = args.length === 1 && ["--help", "-h"].includes(args[0] ?? "");
  const valid = help || (new Set(args).size === args.length && args.every((arg) => ["--yes", "--force"].includes(arg)));
  if (!valid) {
    const translation = injected ?? { translator: loadNodeTranslator("cli") };
    throw new Error(updateText(translation, "update.invalidArguments", "Invalid update arguments. {help}", { help: updateText(translation, "update.help", HELP) }));
  }
  const original = injected ?? defaultDependencies();
  const deps = { ...original, env: { ...original.env } };
  const pinnedVersion = deps.env[INTERNAL_NPM_VERSION];
  const expectedProfile = deps.env[INTERNAL_UPDATE_PROFILE];
  const expectedInstallation = deps.env[INTERNAL_UPDATE_INSTALLATION];
  delete deps.env["PI_WEB_INTERNAL_NPM_UPDATE_VERSION"];
  delete deps.env["PI_WEB_INTERNAL_UPDATE_PROFILE"];
  delete deps.env["PI_WEB_INTERNAL_UPDATE_INSTALLATION"];
  if (injected === undefined) {
    delete process.env["PI_WEB_INTERNAL_NPM_UPDATE_VERSION"];
    delete process.env["PI_WEB_INTERNAL_UPDATE_PROFILE"];
    delete process.env["PI_WEB_INTERNAL_UPDATE_INSTALLATION"];
  }
  if (help) {
    deps.log(updateText(deps, "update.help", HELP));
    return;
  }
  const nested = truthy(deps.env["PI_WEB_SESSION"]);
  const hasExpectedIdentity = expectedProfile !== undefined || expectedInstallation !== undefined;
  if (hasExpectedIdentity && (deps.platform !== "darwin" || nested || !args.includes("--yes")
    || expectedProfile === undefined || !isHostAbsoluteAgentDir(expectedProfile)
    || expectedInstallation === undefined || !/^[a-f0-9]{64}$/.test(expectedInstallation))) {
    throw new Error(updateText(deps, "update.invalidIdentityHandoff", "Invalid internal update identity handoff; nothing changed."));
  }
  const agentDir = await deps.agentDir();
  if (!isHostAbsoluteAgentDir(agentDir)) throw new Error(updateText(deps, "update.profileAbsolute", "Cannot safely resolve the Pi profile: expected a host-absolute directory."));
  if (expectedProfile !== undefined && await deps.realpath(expectedProfile) !== await deps.realpath(agentDir)) {
    throw new Error(updateText(deps, "update.handoffIdentityChanged", "The update handoff identity changed; no install or restart was run."));
  }
  const installation = await deps.detectInstallation(agentDir);
  if (hasExpectedIdentity && installation.kind !== "local" && installation.kind !== "npm-global" && installation.kind !== "pi-package") {
    throw new Error(updateText(deps, "update.invalidIdentityHandoff", "Invalid internal update identity handoff; nothing changed."));
  }
  if (expectedInstallation !== undefined && expectedInstallation !== await installationIdentity(deps, installation)) {
    throw new Error(updateText(deps, "update.handoffIdentityChanged", "The update handoff identity changed; no install or restart was run."));
  }
  if (pinnedVersion !== undefined && (!isExactVersion(pinnedVersion) || deps.platform !== "darwin"
    || nested || !args.includes("--yes") || installation.kind !== "npm-global")) {
    throw new Error(updateText(deps, "update.invalidHandoff", "Invalid internal npm update handoff; nothing changed."));
  }
  if (installation.kind === "unknown") {
    deps.log(updateText(deps, "update.unknownInstallation", "No automatic update for an unknown installation. Update using the installation's original tooling, then run pi-web restart from a host terminal. Nothing changed."));
    return;
  }
  if (installation.kind !== "docker" && nested && deps.platform !== "linux" && deps.platform !== "darwin") {
    throw new Error(updateText(deps, "update.nestedRefused", "Native update refused inside a PI WEB session: restarting its daemon could kill the updater. Open a host terminal outside PI WEB and run pi-web update there. --yes does not bypass this safety check."));
  }
  const command = (executable: string, commandArgs: string[], env = deps.env): PiWebUpdateCommand => ({ executable, args: commandArgs, env: { ...env } });
  let update: PiWebUpdateCommand;
  let updateAfterPull: PiWebUpdateCommand[] = [];
  let localCheckoutPull: PiWebUpdateCommand | undefined;
  let restart: PiWebUpdateCommand | undefined;
  let npmTargetVersion: string | undefined;
  if (installation.kind === "docker") {
    if (installation.dockerMode !== "runtime" && installation.dockerMode !== "dev") {
      throw new Error(updateText(deps, "update.dockerModeUnknown", "Docker installation mode is unknown. Use the original pi-web-docker host installation to update; nothing changed."));
    }
    update = command("pi-web-docker", [...(installation.dockerMode === "dev" ? ["--dev"] : []), "update"]);
  } else {
    if (installation.path === undefined || !isAbsolute(installation.path)) throw new Error(updateText(deps, "update.installationMissing", "Cannot safely locate this PI WEB installation; nothing changed."));
    restart = command(deps.nodeExecutable, [join(installation.path, "dist", "cli.js"), "restart"]);
    if (installation.kind === "local") {
      const localPlan = await planLocalCheckoutUpdate(deps, installation.path);
      localCheckoutPull = localPlan.pull;
      update = localPlan.pull;
      updateAfterPull = [localPlan.install, localPlan.build];
    } else if (installation.kind === "npm-global") {
      const root = installation.npmRoot;
      if (root === undefined || !isAbsolute(root)) throw new Error(updateText(deps, "update.npmInstallationMissing", "Cannot safely locate this global npm installation; nothing changed."));
      // Unix npm prefixes use lib/node_modules; Windows prefixes use node_modules.
      const prefix = basename(dirname(root)) === "lib" ? dirname(dirname(root)) : dirname(root);
      const actualRoot = await deps.capture(command("npm", ["root", "--global", "--prefix", prefix]));
      if (await deps.realpath(actualRoot) !== await deps.realpath(root)
        || await deps.realpath(join(root, PACKAGE_NAME)) !== await deps.realpath(installation.path)) {
        throw new Error(updateText(deps, "update.npmTargetMismatch", "Global npm target does not match this installation; nothing changed."));
      }
      let latestVersion: string;
      try {
        const version: unknown = pinnedVersion ?? JSON.parse(await deps.capture(command("npm", ["view", "--global", "--prefix", resolve(prefix), `${PACKAGE_NAME}@latest`, "version", "--json"])));
        if (typeof version !== "string" || !isExactVersion(version)) {
          throw new Error("npm did not return a package version");
        }
        latestVersion = version;
        npmTargetVersion = version;
      } catch (error: unknown) {
        throw new Error(updateText(deps, "update.npmLatestFailed", "Cannot determine the latest PI WEB npm version; no install or restart was run."), { cause: error });
      }
      const installed: unknown = JSON.parse(await deps.readFile(join(installation.path, "package.json")));
      if (typeof installed !== "object" || installed === null || !("version" in installed) || typeof installed.version !== "string") {
        throw new Error(updateText(deps, "update.npmInstalledUnknown", "Cannot determine the installed PI WEB version; nothing changed."));
      }
      if (installed.version === latestVersion && !args.includes("--force")) {
        deps.log(updateText(deps, "update.alreadyCurrent", "PI WEB is already up to date ({version}). Nothing changed. Use --force to reinstall.", { version: latestVersion }));
        return;
      }
      // Install the release we checked, even if the registry tag moves during confirmation.
      update = command("npm", ["install", "--global", "--prefix", resolve(prefix), `${PACKAGE_NAME}@${latestVersion}`, "--allow-scripts=node-pty"]);
    } else {
      if (installation.scope !== "user" || installation.source === undefined || installation.source === "" || !/^(npm:|git:|https?:\/\/|ssh:\/\/)/.test(installation.source)) {
        throw new Error(updateText(deps, "update.piScopeUnsupported", "Only user-scope remote Pi packages can be updated automatically. Update this package with its original tooling; nothing changed."));
      }
      // --no-approve excludes project settings even in previously trusted projects.
      // An explicit extension target cannot invoke Pi's universal/self updater.
      update = command(deps.nodeExecutable, [deps.piCliPath, "update", "--no-approve", "--extension", installation.source], {
        ...deps.env, [PI_CODING_AGENT_DIR_ENV]: agentDir,
      });
    }
  }
  let restartUnit: string | undefined;
  let launchdHandoff: LaunchdUpdateHandoff | undefined;
  if (restart !== undefined) {
    await preflightNativeServices(deps);
    if (nested && deps.platform === "linux") {
      restartUnit = `pi-web-update-restart-${deps.uniqueId()}`;
      const dispatchArgs = systemdDispatchArgs(deps);
      // Exercise the same external owner and environment without touching services.
      // --wait is only for this harmless probe, never for the actual restart.
      try {
        await deps.capture(command("systemd-run", [
          ...dispatchArgs, `--unit=${restartUnit}-preflight`, "--wait", "--",
          deps.nodeExecutable, "--eval", "process.exit(0)",
        ]));
      } catch (error) {
        throw new Error(updateText(deps, "update.systemdDispatchFailed", "Cannot safely dispatch a detached systemd restart. Use a host terminal outside PI WEB; nothing changed."), { cause: error });
      }
      restart = command("systemd-run", [...dispatchArgs, `--unit=${restartUnit}`, "--", restart.executable, ...restart.args]);
    } else if (nested && deps.platform === "darwin") {
      launchdHandoff = await createLaunchdUpdateHandoff(deps, installation, agentDir, args.includes("--force"), npmTargetVersion);
    }
  }
  deps.log(updateText(deps, "update.target", "Update target: {target}", { target: `${installation.kind}${installation.path === undefined ? "" : ` at ${JSON.stringify(installation.path)}`}` }));
  deps.log(updateText(deps, "update.install", "Install: {command}", { command: [update, ...updateAfterPull].map((step) => [step.executable, ...step.args].map((value) => JSON.stringify(value)).join(" ")).join(" && ") }));
  if (restart !== undefined) {
    const handoffDescription = restartUnit === undefined
      ? launchdHandoff === undefined ? "" : updateText(deps, "update.launchdHandoff", " via detached launchd user agent {target}", { target: launchdHandoff.target })
      : updateText(deps, "update.systemdHandoff", " via detached systemd user unit {unit}", { unit: restartUnit });
    deps.log(updateText(deps, "update.afterInstall", "After install succeeds: {command}{handoff}.", { command: `${JSON.stringify(deps.nodeExecutable)} ${JSON.stringify(join(installation.path ?? "", "dist", "cli.js"))} restart`, handoff: handoffDescription }));
    if (launchdHandoff !== undefined) deps.log(updateText(deps, "update.output", "Detached update output: {path}", { path: launchdHandoff.logPath }));
  } else {
    deps.log(updateText(deps, "update.dockerOwnsRestart", "The Docker installer owns the update and service restart."));
  }
  deps.log(updateText(deps, "update.warning", WARNING));
  if (!args.includes("--yes")) {
    if (!deps.interactive) throw new Error(updateText(deps, "update.consentRequired", "Noninteractive update requires explicit --yes consent. Nothing changed."));
    if (!await deps.confirm(updateText(deps, "update.confirm", "Proceed with the update and restart?"))) {
      deps.log(updateText(deps, "update.cancelled", "Update cancelled. Nothing changed."));
      return;
    }
  }
  if (launchdHandoff !== undefined) {
    await dispatchLaunchdUpdate(deps, launchdHandoff);
    deps.log(updateText(deps, "update.launchdDispatched", "Update handed off to launchd user agent {target}; completion is not verified. Inspect {path}.", { target: launchdHandoff.target, path: launchdHandoff.logPath }));
    return;
  }
  if (localCheckoutPull !== undefined) {
    // Confirmation can be left open while the user edits or changes branches.
    await planLocalCheckoutUpdate(deps, installation.path ?? "");
    try {
      await deps.run(localCheckoutPull);
    } catch (error: unknown) {
      throw new Error(updateText(deps, "update.checkoutPullFailed", "Could not fast-forward the local checkout. Ensure it is clean, has a reachable upstream, and can be pulled without a merge; no install or restart was run."), { cause: error });
    }
    for (const step of updateAfterPull) await deps.run(step);
  } else {
    await deps.run(update);
  }
  if (restart !== undefined) {
    await deps.run(restart);
    if (restartUnit !== undefined) deps.log(updateText(deps, "update.systemdDispatched", "Restart dispatched, not verified complete. Inspect journalctl --user -u {unit}.", { unit: restartUnit }));
  }
}

interface LocalCheckoutUpdatePlan {
  pull: PiWebUpdateCommand;
  install: PiWebUpdateCommand;
  build: PiWebUpdateCommand;
}

async function planLocalCheckoutUpdate(deps: PiWebUpdateDependencies, path: string): Promise<LocalCheckoutUpdatePlan> {
  const gitEnvironment = { ...deps.env, GIT_TERMINAL_PROMPT: "0" };
  const git = (args: string[]): PiWebUpdateCommand => ({ executable: "git", args: ["-C", path, ...args], env: { ...gitEnvironment } });
  const captureGit = async (args: string[], failure: string): Promise<string> => {
    try {
      return (await deps.capture(git(args))).trim();
    } catch (error: unknown) {
      throw new Error(updateText(deps, "update.checkoutInspectionFailed", "{reason} Nothing changed.", { reason: failure }), { cause: error });
    }
  };
  const gitRoot = await captureGit(["rev-parse", "--show-toplevel"], updateText(deps, "update.checkoutInspectRoot", "Cannot safely update the local installation: it is not a Git checkout or its root could not be inspected."));
  if (gitRoot === "" || await deps.realpath(gitRoot) !== await deps.realpath(path)) {
    throw new Error(updateText(deps, "update.checkoutRootMismatch", "Cannot safely update the local installation: the package root is not the Git checkout root. Nothing changed."));
  }
  const status = await captureGit(["status", "--porcelain=v1", "--untracked-files=all"], updateText(deps, "update.checkoutInspectStatus", "Cannot inspect the local checkout status."));
  if (status !== "") {
    throw new Error(updateText(deps, "update.checkoutDirty", "The local checkout has uncommitted or untracked changes. Commit, stash, or remove them before updating; nothing changed."));
  }
  const branch = await captureGit(["symbolic-ref", "--quiet", "--short", "HEAD"], updateText(deps, "update.checkoutInspectBranch", "The local checkout is detached or its current branch could not be determined."));
  if (branch === "") throw new Error(updateText(deps, "update.checkoutDetached", "The local checkout is detached; check out a branch with an upstream before updating. Nothing changed."));
  const upstream = await captureGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], updateText(deps, "update.checkoutNoUpstream", "The local checkout branch {branch} has no upstream branch configured.", { branch: JSON.stringify(branch) }));
  if (upstream === "") throw new Error(updateText(deps, "update.checkoutInspectionFailed", "{reason} Nothing changed.", { reason: updateText(deps, "update.checkoutNoUpstream", "The local checkout branch {branch} has no upstream branch configured.", { branch: JSON.stringify(branch) }) }));
  return {
    pull: git(["pull", "--ff-only"]),
    install: { executable: "npm", args: ["--prefix", path, "install"], env: { ...deps.env } },
    build: { executable: "npm", args: ["--prefix", path, "run", "build"], env: { ...deps.env } },
  };
}

async function createLaunchdUpdateHandoff(
  deps: PiWebUpdateDependencies,
  installation: PiWebInstallationInfo,
  agentDir: string,
  force: boolean,
  npmTargetVersion?: string,
): Promise<LaunchdUpdateHandoff> {
  if (installation.path === undefined || !isAbsolute(installation.path)) {
    throw new Error(updateText(deps, "update.handoffInstallationMissing", "Cannot safely locate this PI WEB installation for a launchd handoff; nothing changed."));
  }
  if (!isAbsolute(deps.home) || !isAbsolute(deps.cwd) || !isAbsolute(deps.nodeExecutable)) {
    throw new Error(updateText(deps, "update.handoffRelativePath", "Cannot safely create a launchd handoff from a relative path; nothing changed."));
  }
  if (!Number.isInteger(deps.userId) || deps.userId < 0) {
    throw new Error(updateText(deps, "update.handoffUserMissing", "Cannot safely resolve the macOS user domain for a launchd handoff; nothing changed."));
  }
  const id = deps.uniqueId();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error(updateText(deps, "update.handoffIdentifierInvalid", "Cannot safely create a launchd handoff with an invalid identifier; nothing changed."));
  }
  const label = `${UPDATE_HANDOFF_LABEL_PREFIX}-${id}`;
  const domain = `gui/${String(deps.userId)}`;
  const environment = launchdHandoffEnvironment(deps);
  environment[PI_CODING_AGENT_DIR_ENV] = agentDir;
  environment[INTERNAL_UPDATE_PROFILE] = agentDir;
  environment[INTERNAL_UPDATE_INSTALLATION] = await installationIdentity(deps, installation);
  if (npmTargetVersion !== undefined) environment[INTERNAL_NPM_VERSION] = npmTargetVersion;
  const plistPath = join(deps.home, ".pi-web", "update-handoffs", `${label}.plist`);
  const logPath = join(deps.home, ".pi-web", "logs", `${label}.log`);
  return {
    domain,
    label,
    target: `${domain}/${label}`,
    plistPath,
    logPath,
    environment,
    plist: renderLaunchdUpdatePlist({
      label,
      force,
      nodeExecutable: deps.nodeExecutable,
      cliPath: join(installation.path, "dist", "cli.js"),
      workingDirectory: deps.cwd,
      environment,
      logPath,
    }),
  };
}

async function installationIdentity(deps: PiWebUpdateDependencies, installation: PiWebInstallationInfo): Promise<string> {
  const identity = {
    kind: installation.kind,
    path: installation.path === undefined ? undefined : await deps.realpath(installation.path),
    npmRoot: installation.npmRoot === undefined ? undefined : await deps.realpath(installation.npmRoot),
    source: installation.source,
    scope: installation.scope,
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

async function dispatchLaunchdUpdate(deps: PiWebUpdateDependencies, handoff: LaunchdUpdateHandoff): Promise<void> {
  let wrotePlist = false;
  try {
    await deps.mkdir(dirname(handoff.plistPath));
    await deps.mkdir(dirname(handoff.logPath));
    // Treat a failed write as potentially leaving a partial file behind.
    wrotePlist = true;
    await deps.writeFile(handoff.plistPath, handoff.plist);
    // bootstrap loads the one-shot plist into the user's GUI launchd domain.
    // RunAtLoad starts it under launchd, outside the sessiond process group that
    // is about to be restarted. KeepAlive is explicitly false so an update
    // failure cannot turn into an automatic retry loop.
    await deps.run({
      executable: "launchctl",
      args: ["bootstrap", handoff.domain, handoff.plistPath],
      env: handoff.environment,
    });
  } catch (error: unknown) {
    if (wrotePlist) await removeHandoffPlist(deps, handoff.plistPath);
    throw new Error(updateText(deps, "update.launchdDispatchFailed", "Cannot safely dispatch a detached launchd update. Use a host terminal outside PI WEB; nothing changed."), { cause: error });
  }

  // The plist is deliberately outside ~/Library/LaunchAgents, so it is not
  // loaded again at the next login. launchd has already parsed it after a
  // successful bootstrap; retaining only the log keeps the handoff ephemeral.
  await removeHandoffPlist(deps, handoff.plistPath);
}

async function removeHandoffPlist(deps: PiWebUpdateDependencies, path: string): Promise<void> {
  try {
    await deps.removeFile(path);
  } catch (error: unknown) {
    deps.log(updateText(deps, "update.handoffCleanupFailed", "Warning: could not remove temporary launchd handoff {path}: {error}", { path: JSON.stringify(path), error: error instanceof Error ? error.message : String(error) }));
  }
}

const handoffEnvironmentKeys = new Set([
  "HOME", "PATH", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "NODE_EXTRA_CA_CERTS",
  "PI_WEB_CONFIG", "PI_WEB_DATA_DIR", "PI_WEB_PI_PACKAGE_DIR", "PI_WEB_SESSIOND_SOCKET", "PI_WEB_SESSIOND_URL", "PI_WEB_SESSIOND_HOST", "PI_WEB_SESSIOND_PORT",
  "PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_WEB_AGENT_DIR", "PI_WEB_AGENT_SESSION_DIR",
]);

function launchdHandoffEnvironment(deps: PiWebUpdateDependencies): NodeJS.ProcessEnv {
  const source = deps.env;
  const environment: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(source).sort()) {
    if (!handoffEnvironmentKeys.has(key)) continue;
    const value = source[key];
    if (key === "PI_WEB_SESSIOND_URL" && value !== undefined && !safeDaemonUrl(value)) {
      throw new Error(updateText(deps, "update.unsafeDaemonUrl", "Cannot hand off an unsafe session daemon URL; use a credential-free endpoint. Nothing changed."));
    }
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

interface LaunchdUpdatePlistInput {
  label: string;
  force: boolean;
  nodeExecutable: string;
  cliPath: string;
  workingDirectory: string;
  environment: NodeJS.ProcessEnv;
  logPath: string;
}

function renderLaunchdUpdatePlist(input: LaunchdUpdatePlistInput): string {
  const programArguments = [input.nodeExecutable, input.cliPath, "update", "--yes", ...(input.force ? ["--force"] : [])];
  const environmentEntries = Object.keys(input.environment)
    .sort()
    .map((key) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(input.environment[key] ?? "")}</string>\n`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments.map((argument) => `    <string>${xmlEscape(argument)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(input.workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${environmentEntries}  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(input.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(input.logPath)}</string>
</dict>
</plist>
`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function preflightNativeServices(deps: PiWebUpdateDependencies): Promise<void> {
  if (deps.platform !== "linux" && deps.platform !== "darwin") throw new Error(updateText(deps, "update.nativeUnsupported", "Automatic native update requires Linux or macOS services; nothing changed."));
  const installed = Object.entries(nativeServiceManagerRefs).filter(([, ref]) => deps.exists(deps.platform === "linux"
    ? join(deps.home, ".config", "systemd", "user", ref.systemdName)
    : join(deps.home, "Library", "LaunchAgents", ref.launchdPlistName)));
  if (!installed.some(([id]) => id === "sessiond") || !installed.some(([id]) => id === "web" || id === "uiDev")) {
    throw new Error(updateText(deps, "update.nativeServicesMissing", "Native services are missing or incomplete. Run pi-web install from a host terminal, or update manually with the original tooling; nothing changed."));
  }
  if (deps.platform === "linux") {
    for (const [, ref] of installed) {
      const state = await deps.capture({ executable: "systemctl", args: ["--user", "show", ref.systemdName, "--property=LoadState", "--value"], env: { ...deps.env } });
      if (state.trim() !== "loaded") throw new Error(updateText(deps, "update.nativeNotLoaded", "Native service {service} is not loaded. Repair services before updating; nothing changed.", { service: ref.systemdName }));
    }
  }
}

function systemdDispatchArgs(deps: PiWebUpdateDependencies): string[] {
  // User-manager services do not inherit the caller's environment. Propagate
  // configuration/runtime selection deliberately, not terminal/session secrets.
  // Preserve cwd too: config and data overrides may be relative paths.
  const keys = Object.keys(launchdHandoffEnvironment(deps));
  return ["--user", "--collect", "--expand-environment=no", `--working-directory=${deps.cwd}`,
    ...keys.filter((key) => deps.env[key] !== undefined).map((key) => `--setenv=${key}`)];
}

function safeDaemonUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "" && url.search === "" && url.hash === "";
  } catch { return false; }
}

function isExactVersion(value: string): boolean {
  if (value.length > 256) return false;
  const match = VERSION_PATTERN.exec(value);
  return match !== null && match.slice(1, 4).every((part) => Number.isSafeInteger(Number(part)))
    && (match[4] === undefined || match[4].split(".").every((part) => !/^\d+$/.test(part)
      || (!/^0\d+$/.test(part) && Number.isSafeInteger(Number(part)))));
}

function updateText(deps: Pick<PiWebUpdateDependencies, "translator">, key: string, fallback: string, parameters?: Record<string, string>): string {
  return (deps.translator ?? createTranslator("en", {}))(key, fallback, parameters);
}

function truthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

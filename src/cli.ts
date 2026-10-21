#!/usr/bin/env node
import { loadNodeTranslator } from "./localization.js";
import { createTranslator, type Translator } from "./shared/i18n.js";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPiWebConfigPath, defaultPiWebDataDir, effectivePiWebConfig, examplePiWebConfig } from "./config.js";
import { packageVersion, printPiWebVersionReport } from "./piWebVersionReport.js";
import { checkNodePtyDarwinSpawnHelper, formatNodePtyDarwinSpawnHelperCheck } from "./server/diagnostics/nodePtySpawnHelper.js";
import { checkNodePtyNativeModule, formatNodePtyNativeModuleCheck } from "./server/diagnostics/nodePtyNativeModule.js";
import {
  installNativeServiceCandidate,
  nativeServiceInstallFailureNeedsPathAdvice,
  type NativeServiceInstallCandidate,
  type NativeServiceInstallFailure,
} from "./nativeServices/serviceInstall.js";
import {
  minimumSupportedNodeVersion,
  nativeServiceManagerRefs,
  productionNativeServiceIds,
  type NativeServiceBackend,
  type NativeServiceId,
  type NativeServiceManagerRef,
  type NativeServicePlan,
  type NativeServiceShell,
  type ProductionNativeServicePlanInput,
} from "./nativeServices/servicePlan.js";
import {
  formatNativeServiceDoctorResult,
  inferInstalledNativeServiceMode,
  inspectInstalledDevelopmentServiceInput,
  inspectInstalledProductionServiceContext,
  runNativeServiceDoctor,
  type InstalledNativeServiceDefinition,
  type NativeServiceDoctorReport,
  type NativeServiceDoctorTarget,
} from "./nativeServices/serviceDoctor.js";
import {
  createNativeServiceAuthoritativeProbe,
  nativeServicePrerequisiteShellCheck,
} from "./nativeServices/serviceProbe.js";
import { renderLaunchdPlist, renderSystemdUnit } from "./nativeServices/serviceRendering.js";

const PI_WEB_PACKAGE_NAME = "@chainingintention/pi-web-cn";

const systemdServiceDir = join(homedir(), ".config", "systemd", "user");
const launchdServiceDir = join(homedir(), "Library", "LaunchAgents");
const logDir = join(defaultPiWebDataDir(), "logs");

type InstallMode = "production" | "dev";
type ServiceId = NativeServiceId;
type ServiceBackend = NativeServiceBackend;
type Check = [string, string[]];

interface InstallOptions {
  host: string;
  port: string;
  mode: InstallMode;
  config?: string;
}

interface ServiceRef extends NativeServiceManagerRef {
  id: ServiceId;
}

type ServiceHealth = "running" | "stopped" | "not-installed" | "unknown";

interface ServiceRuntimeStatus {
  ref: ServiceRef;
  health: ServiceHealth;
  detail: string;
  target: string;
  filePath: string;
  pid?: string;
}

const serviceRefs: Record<ServiceId, ServiceRef> = {
  sessiond: { id: "sessiond", ...nativeServiceManagerRefs.sessiond },
  web: { id: "web", ...nativeServiceManagerRefs.web },
  uiDev: { id: "uiDev", ...nativeServiceManagerRefs.uiDev },
};

const productionServiceIds: ServiceId[] = [...productionNativeServiceIds];
const startServiceOrder: ServiceId[] = ["sessiond", "web", "uiDev"];
const stopServiceOrder: ServiceId[] = ["web", "uiDev", "sessiond"];
// Restart web/UI before sessiond: when `pi-web restart` runs in a pi-web
// terminal (owned by sessiond), restarting sessiond kills the command, so any
// services handled after it would never be restarted.
const restartServiceOrder: ServiceId[] = ["web", "uiDev", "sessiond"];

function platformLabel(): string {
  if (process.platform === "darwin") return "macOS";
  if (process.platform === "linux") return "Linux";
  if (process.platform === "win32") return "Windows";
  return process.platform;
}

export function serviceBackendForPlatform(platform: NodeJS.Platform): ServiceBackend | undefined {
  if (platform === "linux") return { kind: "systemd", label: "systemd user services" };
  if (platform === "darwin") return { kind: "launchd", label: "LaunchAgents" };
  return undefined;
}

function currentServiceBackend(): ServiceBackend | undefined {
  return serviceBackendForPlatform(process.platform);
}

function requireServiceBackend(command: string, t: Translator = createTranslator("en", {})): ServiceBackend {
  const backend = currentServiceBackend();
  if (backend !== undefined) return backend;
  throw new Error(t("service.unsupported", "`{command}` requires a supported per-user service manager (systemd user services or LaunchAgents) and is not supported on {platform}.\n\n{advice}", { command, platform: platformLabel(), advice: manualRunAdvice(t) }));
}

function supportsSystemdUserServices(): boolean {
  return currentServiceBackend()?.kind === "systemd";
}

function manualRunAdvice(t: Translator = createTranslator("en", {})): string {
  return [
    t("manual.checkout", "Run PI WEB manually from a checkout:"),
    "  npm run start:sessiond",
    "  PI_WEB_PORT=8504 npm start",
    "",
    t("manual.singleTerminal", "For development in one terminal:"),
    "  npm run dev",
    "",
    t("manual.split", "For split development, keep sessiond separate and run web/API plus Vite UI separately:"),
    "  npm run dev:sessiond",
    "  npm run dev:web",
    "  npm run dev:client",
  ].join("\n");
}

function run(command: string, args: string[], options: { check?: boolean } = {}): number {
  const result = spawnSync(command, args, { stdio: "inherit" });
  const status = result.status ?? 1;
  if (options.check === true && status !== 0) process.exit(status);
  return status;
}

function outputText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function capture(command: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const errorMessage = result.error instanceof Error ? result.error.message : "";
  const stderr = outputText(result.stderr);
  return { status: result.status ?? 1, stdout: outputText(result.stdout), stderr: stderr === "" ? errorMessage : stderr };
}

function runQuiet(command: string, args: string[]): number {
  return capture(command, args).status;
}

function hasCommand(command: string): boolean {
  return capture("/usr/bin/env", ["sh", "-c", `command -v ${shellSingleQuote(command)}`]).status === 0;
}

function isLingerEnabled(): boolean | undefined {
  if (!hasCommand("loginctl")) return undefined;
  const result = capture("loginctl", ["show-user", userInfo().username, "-p", "Linger"]);
  if (result.status !== 0) return undefined;
  const value = result.stdout.trim();
  if (value === "Linger=yes") return true;
  if (value === "Linger=no") return false;
  return undefined;
}

function parseInstallOptions(args: string[], t: Translator = createTranslator("en", {})): InstallOptions {
  const options: InstallOptions = { host: "127.0.0.1", port: "8504", mode: "production" };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--host") {
      const value = args[i + 1];
      if (value === undefined) throw new Error(t("install.hostRequired", "--host requires a value"));
      options.host = value;
      i += 1;
    } else if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
    } else if (arg === "--port") {
      const value = args[i + 1];
      if (value === undefined) throw new Error(t("install.portRequired", "--port requires a value"));
      options.port = value;
      i += 1;
    } else if (arg.startsWith("--port=")) {
      options.port = arg.slice("--port=".length);
    } else if (arg === "--config") {
      const value = args[i + 1];
      if (value === undefined) throw new Error(t("install.configRequired", "--config requires a value"));
      options.config = value;
      i += 1;
    } else if (arg.startsWith("--config=")) {
      options.config = arg.slice("--config=".length);
    } else if (arg === "--dev") {
      options.mode = "dev";
    } else if (arg === "--user-systemd") {
      // Accepted for backwards-compatible readability; PI WEB chooses the native user service backend automatically.
    } else {
      throw new Error(t("install.unknownOption", "Unknown install option: {arg}", { arg: arg }));
    }
  }
  return options;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fishSingleQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function packageRootPath(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function packageEntrypointPath(name: "server" | "sessiond"): string {
  return join(packageRootPath(), "dist", "server", name === "server" ? "index.js" : "sessiond.js");
}

export function regularFileExists(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function detectServiceShell(): NativeServiceShell {
  const userShell = userInfo().shell ?? undefined;
  const envShell = process.env["SHELL"]?.trim();
  const detected = envShell === undefined || envShell === "" ? userShell : envShell;
  const name = basename(detected ?? "").replace(/^-/, "");
  if (name === "bash" || name === "zsh" || name === "fish") {
    return {
      name,
      executable: detected ?? name,
      source: "detected",
      detectedExecutable: detected ?? name,
    };
  }
  return {
    name: "bash",
    executable: "bash",
    source: "fallback",
    detectedExecutable: detected ?? null,
  };
}

function serviceShellCommand(command: string, cwd?: string): string[] {
  const fullCommand = cwd === undefined ? command : `cd ${serviceShellQuote(cwd)} && ${command}`;
  return ["/usr/bin/env", detectServiceShell().executable, "-lc", fullCommand];
}

function serviceShellQuote(value: string): string {
  return detectServiceShell().name === "fish" ? fishSingleQuote(value) : shellSingleQuote(value);
}

function describeServiceShell(): string {
  const shell = detectServiceShell();
  if (shell.source === "fallback") {
    return shell.detectedExecutable === null
      ? "could not detect a supported login shell; using bash"
      : `detected ${shell.detectedExecutable}; using bash because PI WEB currently supports bash, zsh, and fish`;
  }
  return shell.detectedExecutable === null ? shell.name : `${shell.name} (${shell.detectedExecutable})`;
}

function configEnvironment(options: InstallOptions, configPath: string): Record<string, string> {
  return options.config === undefined ? {} : { PI_WEB_CONFIG: configPath };
}

function serviceRefList(ids: ServiceId[]): ServiceRef[] {
  return ids.map((id) => serviceRefs[id]);
}

function allServiceRefs(): ServiceRef[] {
  return serviceRefList(["sessiond", "web", "uiDev"]);
}

function productionServiceRefs(): ServiceRef[] {
  return serviceRefList(productionServiceIds);
}

function orderServiceRefs(refs: ServiceRef[], order: ServiceId[]): ServiceRef[] {
  const byId = new Map(refs.map((ref) => [ref.id, ref]));
  return order.flatMap((id) => {
    const ref = byId.get(id);
    return ref === undefined ? [] : [ref];
  });
}

function startOrder(refs: ServiceRef[]): ServiceRef[] {
  return orderServiceRefs(refs, startServiceOrder);
}

function stopOrder(refs: ServiceRef[]): ServiceRef[] {
  return orderServiceRefs(refs, stopServiceOrder);
}

function restartOrder(refs: ServiceRef[]): ServiceRef[] {
  return orderServiceRefs(refs, restartServiceOrder);
}

function devRootPath(): string {
  return resolve(process.cwd());
}

function validateDevCheckout(root: string, t: Translator): void {
  const packageJsonPath = join(root, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(t("install.checkoutMissing", "Development mode must be installed from a PI WEB checkout. Missing package.json: {path}", { path: packageJsonPath }));
  }

  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!isRecord(parsed) || parsed["name"] !== PI_WEB_PACKAGE_NAME) {
    throw new Error(t("install.checkoutWrong", "Development mode must be installed from a PI WEB checkout. {path} is not {packageName}.", { path: packageJsonPath, packageName: PI_WEB_PACKAGE_NAME }));
  }
}

function launchdLogPath(ref: ServiceRef): string {
  return join(logDir, ref.logName);
}

function installConfigPath(options: InstallOptions): string {
  return options.config === undefined ? defaultPiWebConfigPath() : resolve(options.config);
}

async function writeInitialConfig(options: InstallOptions, configPath: string): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  if (!existsSync(configPath)) {
    await writeFile(configPath, examplePiWebConfig({ host: options.host, port: Number(options.port) }));
  }
}

function systemdServicePath(ref: ServiceRef): string {
  return join(systemdServiceDir, ref.systemdName);
}

function launchdPlistPath(ref: ServiceRef): string {
  return join(launchdServiceDir, ref.launchdPlistName);
}

function serviceFilePath(backend: ServiceBackend, ref: ServiceRef): string {
  return backend.kind === "systemd" ? systemdServicePath(ref) : launchdPlistPath(ref);
}

function serviceFileExists(backend: ServiceBackend, ref: ServiceRef): boolean {
  return existsSync(serviceFilePath(backend, ref));
}

function installedServiceIds(backend: ServiceBackend): Set<ServiceId> {
  return new Set(allServiceRefs().filter((ref) => serviceFileExists(backend, ref)).map((ref) => ref.id));
}

function installedServiceRefs(backend: ServiceBackend): ServiceRef[] {
  const installed = startOrder(allServiceRefs().filter((ref) => serviceFileExists(backend, ref)));
  return installed.length === 0 ? productionServiceRefs() : installed;
}

async function installSystemdServices(plan: NativeServicePlan): Promise<void> {
  const selected = new Set<ServiceId>(plan.services.map((service) => service.id));
  const obsolete = stopOrder(allServiceRefs().filter((ref) => !selected.has(ref.id)));

  for (const ref of obsolete) {
    runQuiet("systemctl", ["--user", "disable", "--now", ref.systemdName]);
    await rm(systemdServicePath(ref), { force: true });
  }

  await mkdir(systemdServiceDir, { recursive: true });
  for (const service of plan.services) {
    await writeFile(join(systemdServiceDir, service.manager.systemdName), renderSystemdUnit(plan, service));
  }

  const names = plan.services.map((service) => service.manager.systemdName);
  run("systemctl", ["--user", "daemon-reload"], { check: true });
  run("systemctl", ["--user", "enable", ...names], { check: true });
  run("systemctl", ["--user", "restart", ...names], { check: true });
}

function launchdDomain(): string {
  return `gui/${String(userInfo().uid)}`;
}

function launchdServiceTarget(ref: ServiceRef): string {
  return `${launchdDomain()}/${ref.launchdLabel}`;
}

function launchdIsLoaded(ref: ServiceRef): boolean {
  return capture("launchctl", ["print", launchdServiceTarget(ref)]).status === 0;
}

function launchdBootout(ref: ServiceRef): void {
  runQuiet("launchctl", ["bootout", launchdServiceTarget(ref)]);
}

function launchdBootstrap(ref: ServiceRef): void {
  run("launchctl", ["bootstrap", launchdDomain(), launchdPlistPath(ref)], { check: true });
  run("launchctl", ["enable", launchdServiceTarget(ref)], { check: true });
}

function launchdStart(ref: ServiceRef): void {
  if (!launchdIsLoaded(ref)) launchdBootstrap(ref);
  run("launchctl", ["kickstart", launchdServiceTarget(ref)], { check: true });
}

async function installLaunchdServices(plan: NativeServicePlan): Promise<void> {
  const selected = new Set<ServiceId>(plan.services.map((service) => service.id));

  await mkdir(launchdServiceDir, { recursive: true });
  await mkdir(logDir, { recursive: true });

  for (const ref of stopOrder(allServiceRefs())) launchdBootout(ref);

  for (const ref of allServiceRefs().filter((candidate) => !selected.has(candidate.id))) {
    await rm(launchdPlistPath(ref), { force: true });
  }

  for (const service of plan.services) {
    const plistPath = join(launchdServiceDir, service.manager.launchdPlistName);
    await writeFile(plistPath, renderLaunchdPlist(plan, service, logDir));
  }

  for (const service of plan.services) launchdStart(serviceRefFromPlan(service.id, service.manager));
}

async function installNativeServices(plan: NativeServicePlan): Promise<void> {
  if (plan.backend.kind === "systemd") await installSystemdServices(plan);
  else await installLaunchdServices(plan);
}

function serviceRefFromPlan(id: ServiceId, manager: NativeServiceManagerRef): ServiceRef {
  return { id, ...manager };
}

async function uninstallSystemdServices(): Promise<void> {
  for (const ref of stopOrder(allServiceRefs())) {
    runQuiet("systemctl", ["--user", "disable", "--now", ref.systemdName]);
    await rm(systemdServicePath(ref), { force: true });
  }
  runQuiet("systemctl", ["--user", "daemon-reload"]);
}

async function uninstallLaunchdServices(): Promise<void> {
  for (const ref of stopOrder(allServiceRefs())) {
    launchdBootout(ref);
    await rm(launchdPlistPath(ref), { force: true });
  }
}

async function uninstallNativeServices(backend: ServiceBackend): Promise<void> {
  if (backend.kind === "systemd") await uninstallSystemdServices();
  else await uninstallLaunchdServices();
}

function serviceDisplayName(ref: ServiceRef, t: Translator): string {
  if (ref.id === "sessiond") return t("service.sessiond", "session daemon");
  if (ref.id === "uiDev") return t("service.uiDev", "UI/API dev server");
  return t("service.web", "web server");
}

function statusServiceRefs(backend: ServiceBackend): ServiceRef[] {
  const ids = installedServiceIds(backend);
  if (ids.size === 0) return [];
  if (ids.has("web") && ids.has("uiDev")) return startOrder(allServiceRefs());
  if (ids.has("uiDev")) return serviceRefList(["sessiond", "uiDev"]);
  if (ids.has("web")) return productionServiceRefs();
  return serviceRefList(["sessiond"]);
}

function serviceInstallMode(backend: ServiceBackend, t: Translator): string {
  const ids = installedServiceIds(backend);
  if (ids.size === 0) return t("service.notInstalled", "not installed");
  const hasSessiond = ids.has("sessiond");
  const hasWeb = ids.has("web");
  const hasUiDev = ids.has("uiDev");
  if (hasWeb && hasUiDev) return t("service.mixed", "mixed");
  if (hasUiDev) return hasSessiond ? t("service.development", "development") : t("service.developmentIncomplete", "development (incomplete)");
  if (hasWeb) return hasSessiond ? t("service.production", "production") : t("service.productionIncomplete", "production (incomplete)");
  return t("service.partial", "partial");
}

function makeServiceRuntimeStatus(ref: ServiceRef, health: ServiceHealth, detail: string, target: string, filePath: string, pid?: string): ServiceRuntimeStatus {
  return {
    ref,
    health,
    detail,
    target,
    filePath,
    ...(pid === undefined ? {} : { pid }),
  };
}

function firstOutputLine(...values: string[]): string | undefined {
  for (const value of values) {
    const line = value.trim().split("\n").find((candidate) => candidate.trim() !== "");
    if (line !== undefined) return line.trim();
  }
  return undefined;
}

function systemdMainPid(ref: ServiceRef): string | undefined {
  const result = capture("systemctl", ["--user", "--no-pager", "show", ref.systemdName, "--property=MainPID", "--value"]);
  if (result.status !== 0) return undefined;
  const value = result.stdout.trim();
  return value === "" || value === "0" ? undefined : value;
}

function systemdRuntimeStatus(backend: ServiceBackend, ref: ServiceRef): ServiceRuntimeStatus {
  const target = ref.systemdName;
  const filePath = serviceFilePath(backend, ref);
  if (!serviceFileExists(backend, ref)) return makeServiceRuntimeStatus(ref, "not-installed", "not installed", target, filePath);

  const result = capture("systemctl", ["--user", "--no-pager", "is-active", target]);
  const state = firstOutputLine(result.stdout, result.stderr) ?? "unknown";
  if (result.status === 0 && state === "active") return makeServiceRuntimeStatus(ref, "running", "running", target, filePath, systemdMainPid(ref));
  return makeServiceRuntimeStatus(ref, state === "unknown" ? "unknown" : "stopped", state, target, filePath);
}

function parseLaunchdField(output: string, field: string): string | undefined {
  const match = new RegExp(`^\\s*${field}\\s=\\s(.+)$`, "m").exec(output);
  return match?.[1]?.trim();
}

export function launchdRuntimeDetails(output: string): { state: string; detail: string; pid: string | undefined } {
  const state = parseLaunchdField(output, "state") ?? "unknown";
  const pid = parseLaunchdField(output, "pid");
  const lastExitCode = parseLaunchdField(output, "last exit code");
  const detail = state === "running"
    ? "running"
    : lastExitCode === undefined ? state : `${state} (last exit code ${lastExitCode})`;
  return { state, detail, pid };
}

function launchdRuntimeStatus(backend: ServiceBackend, ref: ServiceRef): ServiceRuntimeStatus {
  const target = launchdServiceTarget(ref);
  const filePath = serviceFilePath(backend, ref);
  if (!serviceFileExists(backend, ref)) return makeServiceRuntimeStatus(ref, "not-installed", "not installed", target, filePath);

  const result = capture("launchctl", ["print", target]);
  if (result.status !== 0) {
    return makeServiceRuntimeStatus(ref, "stopped", firstOutputLine(result.stderr, result.stdout) ?? "not loaded", target, filePath);
  }

  const details = launchdRuntimeDetails(result.stdout);
  const health: ServiceHealth = details.state === "running" ? "running" : details.state === "unknown" ? "unknown" : "stopped";
  return makeServiceRuntimeStatus(ref, health, details.detail, target, filePath, details.pid);
}

function runtimeStatus(backend: ServiceBackend, ref: ServiceRef): ServiceRuntimeStatus {
  return backend.kind === "systemd" ? systemdRuntimeStatus(backend, ref) : launchdRuntimeStatus(backend, ref);
}

function printServiceStatus(status: ServiceRuntimeStatus, t: Translator = createTranslator("en", {})): void {
  const icon = status.health === "running" ? "✓" : "✗";
  const pid = status.pid === undefined ? "" : `, pid ${status.pid}`;
  console.log(`${icon} ${serviceDisplayName(status.ref, t)}: ${status.detail} (${status.target}${pid})`);
  if (status.health === "not-installed") console.log(t("status.missingFile", "  missing service file: {filePath}", { filePath: status.filePath }));
}

function printServiceStatusReport(backend: ServiceBackend, t: Translator = createTranslator("en", {})): boolean {
  const refs = statusServiceRefs(backend);
  console.log(t("status.services", "PI WEB services: {mode} ({backend})", { mode: serviceInstallMode(backend, t), backend: backend.label }));
  if (refs.length === 0) {
    console.log(t("status.noServices", "✗ no PI WEB service files found"));
    console.log(t("status.installAdvice", "  Run `pi-web install` or `pi-web install --dev`."));
    return false;
  }

  const statuses = refs.map((ref) => runtimeStatus(backend, ref));
  for (const status of statuses) printServiceStatus(status, t);
  console.log(t("status.logsAdvice", "\nUse `pi-web logs` for service logs."));
  return statuses.every((status) => status.health === "running");
}

function configuredServiceCommand(name: "PI_WEB_SERVER_EXEC" | "PI_WEB_SESSIOND_EXEC"): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

function productionNativeServicePlanInput(
  backend: ServiceBackend,
  shell: NativeServiceShell,
  environment: Readonly<Record<string, string>>,
): ProductionNativeServicePlanInput {
  return {
    backend,
    shell,
    environment,
    executables: {
      sessiond: {
        configuredCommand: configuredServiceCommand("PI_WEB_SESSIOND_EXEC"),
        namedCommand: "pi-web-sessiond",
        bundledEntrypointPath: packageEntrypointPath("sessiond"),
      },
      web: {
        configuredCommand: configuredServiceCommand("PI_WEB_SERVER_EXEC"),
        namedCommand: "pi-web-server",
        bundledEntrypointPath: packageEntrypointPath("server"),
      },
    },
  };
}

function nativeServiceInstallCandidate(
  options: InstallOptions,
  backend: ServiceBackend,
  configPath: string,
  devRoot: string | undefined,
): NativeServiceInstallCandidate {
  const shell = detectServiceShell();
  const environment = configEnvironment(options, configPath);
  if (options.mode === "production") {
    return {
      mode: "production",
      input: productionNativeServicePlanInput(backend, shell, environment),
    };
  }

  const root = devRoot ?? devRootPath();
  return {
    mode: "development",
    input: {
      backend,
      shell,
      environment,
      workingDirectory: root,
      packageJsonPath: join(root, "package.json"),
    },
  };
}

function printNativeServiceInstallFailure(failure: NativeServiceInstallFailure, t: Translator): void {
  if (failure.kind === "plan-resolution") {
    for (const item of failure.failures) {
      if (item.kind === "probe-infrastructure") {
        console.log(t("install.probeFailure", "✗ Service-manager probe infrastructure failure ({reason}): {message}", { reason: item.reason, message: item.message }));
      } else if (item.kind === "entrypoint-inspection-failure") {
        console.log(t("install.entrypointFailure", "✗ Could not inspect bundled {service} entrypoint {path}: {message}", { service: item.serviceId, path: item.entrypointPath, message: item.message }));
      } else {
        console.log(t("install.commandMissing", "✗ {command} is unavailable to the service manager, and bundled entrypoint {path} is missing.", { command: item.namedCommand, path: item.bundledEntrypointPath }));
        if (item.namedCommandFailure !== null) console.log(`  ${item.namedCommandFailure}`);
      }
    }
    return;
  }

  for (const item of failure.failures) {
    if (item.kind === "probe-infrastructure") {
      console.log(t("install.probeFailure", "✗ Service-manager probe infrastructure failure ({reason}): {message}", { reason: item.reason, message: item.message }));
    } else {
      console.log(`✗ ${item.prerequisite.description}`);
      if (item.detail !== null && item.detail !== item.prerequisite.description) console.log(`  ${item.detail}`);
    }
  }
}

async function install(args: string[], t: Translator = createTranslator("en", {})): Promise<void> {
  const backend = requireServiceBackend("pi-web install", t);
  const options = parseInstallOptions(args, t);
  const devRoot = options.mode === "dev" ? devRootPath() : undefined;
  if (devRoot !== undefined) validateDevCheckout(devRoot, t);
  const configPath = installConfigPath(options);
  const candidate = nativeServiceInstallCandidate(options, backend, configPath, devRoot);

  console.log(t("install.preflight", "Running PI WEB {mode} install preflight checks...", { mode: options.mode }));
  console.log(t("service.backend", "Service backend: {label}", { label: backend.label }));
  console.log(t("service.shell", "Service shell: {value}", { value: describeServiceShell() }));
  if (!printNodePtyNativeModuleCheck(t)) {
    throw new Error(t("install.preflightFailed", "Install preflight checks failed without changing config or services. Fix the failure above, then run `pi-web doctor` for more detail."));
  }
  const result = await installNativeServiceCandidate(candidate, {
    probe: createNativeServiceAuthoritativeProbe(),
    fileExists: regularFileExists,
    writeInitialConfig: () => writeInitialConfig(options, configPath),
    replaceServices: installNativeServices,
  });
  if (!result.ok) {
    printNativeServiceInstallFailure(result.failure, t);
    if (nativeServiceInstallFailureNeedsPathAdvice(result.failure)) printPathSetupAdvice(undefined, t);
    throw new Error(t("install.preflightFailed", "Install preflight checks failed without changing config or services. Fix the failure above, then run `pi-web doctor` for more detail."));
  }
  for (const service of result.plan.services.filter((item) => item.strategy.kind === "configured-override")) {
    console.log(t("install.overrideSkipped", "! {service} uses a configured command override; preflight did not execute that arbitrary command.", { service: service.description }));
  }

  console.log(t("install.started", "\nPI WEB {mode} services are installed and starting.", { mode: options.mode }));
  console.log(t("install.config", "Config: {configPath}", { configPath: configPath }));
  if (options.mode === "dev") {
    console.log(t("install.open", "Open: {url}", { url: "http://127.0.0.1:8505" }));
  } else {
    console.log(t("install.open", "Open: {url}", { url: `http://${options.host === "0.0.0.0" ? "127.0.0.1" : options.host}:${options.port}` }));
  }

  if (backend.kind === "systemd") {
    const linger = isLingerEnabled();
    if (linger === false) {
      console.log(t("install.lingerAdvice", "\nRecommended for server use: keep user services running after logout/reboot:"));
      console.log(`  sudo loginctl enable-linger ${userInfo().username}`);
    } else if (linger === undefined) {
      console.log(t("install.enableLinger", "\nRecommended for server use: enable systemd user lingering so services survive logout/reboot:"));
      console.log(`  sudo loginctl enable-linger ${userInfo().username}`);
    }
  }

  console.log(t("install.commands", "\nUseful commands:"));
  console.log("  pi-web status");
  console.log("  pi-web logs");
  console.log("  pi-web restart");
}

async function uninstall(t: Translator = createTranslator("en", {})): Promise<void> {
  const backend = requireServiceBackend("pi-web uninstall", t);
  await uninstallNativeServices(backend);
  console.log(t("uninstall.done", "PI WEB {label} removed. Production and development service files were removed; config and data were left in place.", { label: backend.label }));
}

function systemdServiceAction(action: "start" | "stop" | "restart", refs: ServiceRef[]): void {
  const orderedRefs = action === "stop" ? stopOrder(refs) : action === "restart" ? restartOrder(refs) : startOrder(refs);
  run("systemctl", ["--user", action, ...orderedRefs.map((ref) => ref.systemdName)], { check: true });
}

function launchdServiceAction(action: "start" | "stop" | "restart", refs: ServiceRef[]): void {
  if (action === "stop") {
    for (const ref of stopOrder(refs)) launchdBootout(ref);
    return;
  }

  if (action === "restart") {
    // Restart each service fully (bootout + start) before moving to the next,
    // so the web/UI services are back up before sessiond is restarted.
    for (const ref of restartOrder(refs)) {
      launchdBootout(ref);
      launchdStart(ref);
    }
    return;
  }

  for (const ref of startOrder(refs)) launchdStart(ref);
}

function serviceAction(action: "start" | "stop" | "restart" | "status", t: Translator = createTranslator("en", {})): void {
  const backend = requireServiceBackend(`pi-web ${action}`, t);
  if (action === "status") {
    if (!printServiceStatusReport(backend, t)) process.exitCode = 1;
    return;
  }

  const refs = installedServiceRefs(backend);
  if (backend.kind === "systemd") systemdServiceAction(action, refs);
  else launchdServiceAction(action, refs);
}

function logs(t: Translator = createTranslator("en", {})): void {
  const backend = requireServiceBackend("pi-web logs", t);
  const refs = installedServiceRefs(backend);
  if (backend.kind === "systemd") {
    run("journalctl", ["--user", ...refs.flatMap((ref) => ["-u", ref.systemdName]), "-f"]);
    return;
  }
  run("tail", ["-F", ...refs.map((ref) => launchdLogPath(ref))]);
}

function serviceShellLabel(): string {
  return `${detectServiceShell().name} -lc`;
}

function commandCheck(command: string): string {
  return `command -v ${serviceShellQuote(command)}`;
}

export function commandWithVersionCheck(command: string): string {
  const found = commandCheck(command);
  const commandWord = serviceShellQuote(command);
  if (detectServiceShell().name === "fish") {
    return `${found} && begin; ${commandWord} --version 2>&1 || true; end`;
  }
  return `${found} && (${commandWord} --version 2>&1 || true)`;
}

export function nodeVersionCheck(): string {
  return nativeServicePrerequisiteShellCheck(detectServiceShell().name, {
    id: "caller.node",
    kind: "node-version",
    command: "node",
    minimumVersion: minimumSupportedNodeVersion,
    description: `node >= ${minimumSupportedNodeVersion}`,
  });
}

export function agentCommandForChecks(env: NodeJS.ProcessEnv = process.env): string {
  return effectivePiWebConfig({ env }).config.agent.command;
}

function generalDoctorChecks(): Check[] {
  const shell = serviceShellLabel();
  const agentCommand = agentCommandForChecks();
  return [
    [`Caller login ${shell} can find node >= ${minimumSupportedNodeVersion}`, serviceShellCommand(nodeVersionCheck())],
    [`Caller login ${shell} can find npm`, serviceShellCommand(commandWithVersionCheck("npm"))],
    [`Caller login ${shell} can find ${agentCommand}`, serviceShellCommand(commandWithVersionCheck(agentCommand))],
  ];
}

function runChecks(checks: Check[]): boolean {
  let failed = false;
  for (const [label, command] of checks) {
    const [bin, ...args] = command;
    if (bin === undefined) continue;
    const result = capture(bin, args);
    const ok = result.status === 0;
    failed ||= !ok;
    console.log(`${ok ? "✓" : "✗"} ${label}`);
    printCheckOutput(result.stdout || result.stderr);
  }
  return !failed;
}

function printCheckOutput(output: string): void {
  const trimmed = output.trim();
  if (trimmed === "") return;
  const lines = trimmed.split("\n");
  for (const line of lines.slice(0, 3)) console.log(`  ${line}`);
  if (lines.length > 3) console.log("  ...");
}

function optionalDoctorChecks(): Check[] {
  const shell = serviceShellLabel();
  return [[`Caller login ${shell} can find optional ripgrep (rg)`, serviceShellCommand(commandCheck("rg"))]];
}

function printOptionalDoctorChecks(t: Translator = createTranslator("en", {})): void {
  let missingOptionalTool = false;
  for (const [label, command] of optionalDoctorChecks()) {
    const [bin, ...args] = command;
    if (bin === undefined) continue;
    const result = capture(bin, args);
    const ok = result.status === 0;
    missingOptionalTool ||= !ok;
    console.log(`${ok ? "✓" : "!"} ${label}`);
    printCheckOutput(result.stdout || result.stderr);
  }
  if (missingOptionalTool) {
    console.log(t("doctor.ripgrep", "  Install ripgrep, or make rg visible to the service shell, for faster all-file @ suggestions."));
    console.log(t("doctor.scanFallback", "  PI WEB falls back to a bounded filesystem scan when rg is unavailable."));
  }
}

function installedServiceDefinitions(
  backend: ServiceBackend,
  ids: readonly ServiceId[],
): InstalledNativeServiceDefinition[] {
  return ids.map((id) => ({
    id,
    contents: readFileSync(serviceFilePath(backend, serviceRefs[id]), "utf8"),
  }));
}

function nativeServiceDoctorTarget(backend: ServiceBackend, t: Translator): NativeServiceDoctorTarget {
  const ids = installedServiceIds(backend);
  const mode = inferInstalledNativeServiceMode(ids);
  if (mode === "ambiguous") {
    return {
      kind: "inspection-failure",
      message: t("doctor.ambiguousMode", "installed service IDs do not identify one mode ({ids}).", { ids: [...ids].join(", ") || "none" }),
    };
  }
  if (mode === "none") {
    return {
      kind: "prospective-production",
      input: productionNativeServicePlanInput(backend, detectServiceShell(), {}),
      reason: t("doctor.noStrategy", "no installed service strategy is available"),
    };
  }
  const expectedIds = mode === "production"
    ? productionNativeServiceIds
    : (["sessiond", "uiDev"] as const);
  const missingId = expectedIds.find((id) => !ids.has(id));
  if (missingId !== undefined) {
    return {
      kind: "inspection-failure",
      message: t("doctor.incompleteSet", "installed {mode} service set is incomplete; {service} is missing.", { mode, service: missingId }),
    };
  }

  let definitions: InstalledNativeServiceDefinition[];
  try {
    definitions = installedServiceDefinitions(
      backend,
      expectedIds,
    );
  } catch (error: unknown) {
    return {
      kind: "inspection-failure",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (mode === "development") {
    const inspection = inspectInstalledDevelopmentServiceInput(backend, definitions, t);
    return inspection.ok
      ? { kind: "installed-development", input: inspection.value }
      : { kind: "inspection-failure", message: inspection.message };
  }

  const inspection = inspectInstalledProductionServiceContext(backend, definitions, t);
  return inspection.ok
    ? {
        kind: "prospective-production",
        input: productionNativeServicePlanInput(backend, inspection.value.shell, inspection.value.environment),
        reason: t("doctor.unrecordedStrategy", "installed executable strategy is not recorded"),
      }
    : { kind: "inspection-failure", message: inspection.message };
}

async function printNativeServiceDoctorChecks(backend: ServiceBackend, t: Translator): Promise<NativeServiceDoctorReport> {
  const result = await runNativeServiceDoctor(nativeServiceDoctorTarget(backend, t), {
    probe: createNativeServiceAuthoritativeProbe(),
    fileExists: regularFileExists,
  });
  const report = formatNativeServiceDoctorResult(result, t);
  for (const line of report.lines) console.log(line);
  printCallerContextComparisons(report, t);
  return report;
}

function printCallerContextComparisons(report: NativeServiceDoctorReport, t: Translator): void {
  if (report.plan === null || report.failedPrerequisites.length === 0) return;
  const seen = new Set<string>();
  for (const prerequisite of report.failedPrerequisites) {
    if (seen.has(prerequisite.id)) continue;
    seen.add(prerequisite.id);
    const service = report.plan.services.find((candidate) => candidate.prerequisites.some((item) => item.id === prerequisite.id));
    const command = nativeServicePrerequisiteShellCheck(report.plan.shell.name, prerequisite);
    const result = captureServiceShell(report.plan.shell, command, service?.workingDirectory ?? null);
    console.log(
      t("doctor.callerComparison", "  Caller-invoked {shell} -lc {outcome} {requirement}; the service-manager result is authoritative.", {
        shell: report.plan.shell.name,
        outcome: result.status === 0 ? t("doctor.satisfies", "satisfies") : t("doctor.unsatisfied", "also does not satisfy"),
        requirement: prerequisite.description,
      }),
    );
  }
}

function captureServiceShell(
  shell: NativeServiceShell,
  command: string,
  workingDirectory: string | null,
): { status: number; stdout: string; stderr: string } {
  const fullCommand = workingDirectory === null
    ? command
    : `cd ${shellQuoteFor(shell.name, workingDirectory)} && ${command}`;
  return capture("/usr/bin/env", [shell.executable, "-lc", fullCommand]);
}

function shellQuoteFor(shell: NativeServiceShell["name"], value: string): string {
  return shell === "fish" ? fishSingleQuote(value) : shellSingleQuote(value);
}

function printPathSetupAdvice(shell: NativeServiceShell = detectServiceShell(), t: Translator = createTranslator("en", {})): void {
  console.log(t("doctor.pathAdvice", "\nPATH setup advice:"));
  if (shell.name === "bash") {
    console.log(t("doctor.bashPath", "  Detected bash. Put PATH setup for node/version managers/tools in ~/.bash_profile or ~/.profile."));
    console.log(t("doctor.bashProfile", "  If ~/.bash_profile exists, bash will not read ~/.profile unless you source it from ~/.bash_profile."));
    console.log(t("doctor.bashHooks", "  Do not rely only on ~/.bashrc or prompt hooks for tools needed by services or agents."));
  } else if (shell.name === "zsh") {
    console.log(t("doctor.zshPath", "  Detected zsh. Put PATH setup for node/version managers/tools in ~/.zprofile, not only ~/.zshrc."));
    console.log(t("doctor.promptHooks", "  Avoid relying on prompt hooks; PI WEB services run non-interactive login shells."));
  } else {
    console.log(t("doctor.fishPath", "  Detected fish. Prefer universal PATH setup such as `fish_add_path -U ...` for tools needed by services or agents."));
    console.log(t("doctor.promptHooks", "  Avoid relying on prompt hooks; PI WEB services run non-interactive login shells."));
  }
}

export function doctorExitCode(
  generalReadinessOk: boolean,
  nativeServicePlanOk: boolean,
  nodePtyRuntimeOk: boolean,
): 0 | 1 {
  return generalReadinessOk && nativeServicePlanOk && nodePtyRuntimeOk ? 0 : 1;
}

async function doctor(t: Translator = createTranslator("en", {})): Promise<void> {
  const backend = currentServiceBackend();
  console.log(t("doctor.platform", "Platform: {value}", { value: platformLabel() }));
  console.log(t("service.backend", "Service backend: {label}", { label: backend?.label ?? t("service.manualOnly", "manual run only") }));
  console.log(t("service.shell", "Service shell: {value}", { value: describeServiceShell() }));
  if (backend === undefined) {
    console.log(t("doctor.nativeSkipped", "- Native user service plan checks skipped on {value}; no native-service drift is reported.", { value: platformLabel() }));
  }
  console.log("");
  await printPiWebVersionReport(t);

  console.log(t("doctor.loginShell", "\nGeneral login-shell readiness (separate from native-service requirements):"));
  const generalReadinessOk = runChecks(generalDoctorChecks());
  printOptionalDoctorChecks(t);

  console.log(t("doctor.terminal", "\nNative terminal runtime readiness:"));
  const nodePtyNativeModuleOk = printNodePtyNativeModuleCheck(t);
  const nodePtySpawnHelperOk = nodePtyNativeModuleOk ? printNodePtyDarwinSpawnHelperCheck(t) : true;

  let nativeServiceReport: NativeServiceDoctorReport | null = null;
  if (backend !== undefined) {
    console.log(t("doctor.services", "\nNative service plan checks (service-manager context):"));
    nativeServiceReport = await printNativeServiceDoctorChecks(backend, t);
  }

  if (supportsSystemdUserServices()) {
    const linger = isLingerEnabled();
    if (linger === true) {
      console.log(t("doctor.lingerEnabled", "✓ systemd user lingering enabled"));
    } else if (linger === false) {
      console.log(t("doctor.lingerDisabled", "✗ systemd user lingering disabled"));
      console.log(t("doctor.lingerCommand", "  Recommended on servers: sudo loginctl enable-linger {username}", { username: userInfo().username }));
    } else {
      console.log(t("doctor.lingerUnknown", "? systemd user lingering unknown"));
      console.log(t("doctor.lingerCommand", "  Recommended on servers: sudo loginctl enable-linger {username}", { username: userInfo().username }));
    }
  } else if (backend?.kind === "launchd") {
    console.log(t("doctor.launchAgents", "- user services start at login with LaunchAgents"));
  } else {
    console.log(t("doctor.lingerSkipped", "- systemd user lingering skipped on {value}", { value: platformLabel() }));
  }

  const nativeServicePlanOk = nativeServiceReport?.ok ?? true;
  const pathFailure = !generalReadinessOk || nativeServiceReport?.pathAdviceRecommended === true;
  if (pathFailure) {
    console.log(t("doctor.compareContexts", "\nIf a command works in your terminal but fails in the service-manager check, compare the caller and manager contexts above."));
    const adviceShell = nativeServiceReport?.pathAdviceRecommended === true && nativeServiceReport.adviceShell !== null
      ? nativeServiceReport.adviceShell
      : detectServiceShell();
    printPathSetupAdvice(adviceShell, t);
  }

  if (generalReadinessOk && backend === undefined) {
    console.log(`\n${manualRunAdvice(t)}`);
  }

  if (doctorExitCode(generalReadinessOk, nativeServicePlanOk, nodePtyNativeModuleOk && nodePtySpawnHelperOk) !== 0) process.exitCode = 1;
}

function printNodePtyNativeModuleCheck(t: Translator): boolean {
  const result = formatNodePtyNativeModuleCheck(checkNodePtyNativeModule(), t);
  for (const line of result.lines) console.log(line);
  return result.ok;
}

function printNodePtyDarwinSpawnHelperCheck(t: Translator): boolean {
  const result = formatNodePtyDarwinSpawnHelperCheck(checkNodePtyDarwinSpawnHelper(), t);
  for (const line of result.lines) console.log(line);
  return result.ok;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cliHelp(t: Translator): string {
  return t("help", `PI WEB

Usage:
  pi-web install [--dev] [--host 127.0.0.1] [--port 8504] [--config ~/.config/pi-web/config.json]
  pi-web uninstall
  pi-web start|stop|restart|status|logs
  pi-web audit <command> [options]
  pi-web doctor
  pi-web version

Audit commands:
  pi-web audit list|stats|export|prune|vacuum

Recommended install:
  npm install -g @chainingintention/pi-web-cn --allow-scripts=node-pty
  pi-web install

Development service install from a checkout:
  pi-web install --dev
`);
}

async function main(): Promise<void> {
  const t = loadNodeTranslator("cli");
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "install") await install(args, t);
  else if (command === "uninstall") await uninstall(t);
  else if (command === "start" || command === "stop" || command === "restart" || command === "status") serviceAction(command, t);
  else if (command === "logs") logs(t);
  else if (command === "audit") {
    const { runNormalToolAuditCommand } = await import("./server/audit/normalToolAuditCli.js");
    runNormalToolAuditCommand(args, { translator: t });
  }
  else if (command === "doctor") await doctor(t);
  else if (command === "version") await printPiWebVersionReport(t);
  else if (command === "--version" || command === "-v") console.log(packageVersion());
  else if (command === "help" || command === "--help" || command === "-h") console.log(cliHelp(t));
  else throw new Error(t("cli.unknownCommand", "Unknown command: {command}", { command: command }));
}

export function isCliEntrypoint(entrypoint: string | undefined = process.argv[1], modulePath: string = fileURLToPath(import.meta.url)): boolean {
  if (entrypoint === undefined) return false;
  if (entrypoint === modulePath) return true;
  try {
    return realpathSync(entrypoint) === realpathSync(modulePath);
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

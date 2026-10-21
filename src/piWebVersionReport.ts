import { createTranslator, type Translator } from "./shared/i18n.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectivePiWebConfig } from "./config.js";
import { SessionDaemonClient } from "./sessiond/sessionDaemonClient.js";
import type { PiWebComponentStatus, PiWebInstallationInfo, PiWebVersionResponse } from "./shared/apiTypes.js";
import { parsePiWebComponentStatus, parsePiWebVersionResponse } from "./shared/piWebStatusParsing.js";

const PI_WEB_PACKAGE_NAME = "@chainingintention/pi-web-cn";
const PI_WEB_VERSION_TIMEOUT_MS = 2000;
const PI_WEB_VERSION_ENDPOINT_PATH = "/api/pi-web/version";
const PI_WEB_STATUS_ENDPOINT_PATH = "/api/pi-web/status";
const DEFAULT_PACKAGE_VERSION = "0.0.0-dev";

interface PackageInfo {
  name: string;
  version: string;
  path: string;
}

export interface RunningVersionInfo {
  generatedAt?: string;
  web?: PiWebComponentStatus;
  sessiond?: PiWebComponentStatus;
  webError?: string;
  webAuthenticationRequired?: boolean;
  sessiondError?: string;
}

export interface PiWebVersionReportOptions {
  /** Environment used only to select and resolve the web/API config. */
  configEnv?: NodeJS.ProcessEnv;
  /** A prior config-selection failure that makes a web/API probe untrustworthy. */
  webEndpointError?: string;
  /** Injectable HTTP boundary for deterministic readiness tests. */
  fetch?: typeof globalThis.fetch;
}

export type RunningComponentId = PiWebComponentStatus["component"];

/**
 * Readiness rule for `pi-web doctor`: an expected running component is ready
 * only when the report carries its status and that status is available and not
 * stale. A component missing from the report (an error-only entry) is not
 * ready. Components that are not expected stay informational regardless of
 * state.
 */
export function runningComponentsReady(info: RunningVersionInfo, expected: readonly RunningComponentId[]): boolean {
  return expected.every((id) => {
    const status = info[id];
    return status !== undefined && status.available && !status.stale;
  });
}

/**
 * Readiness probe for service lifecycle waits: the web component is ready when
 * dependency-free web health endpoint responds. Older hosts fall back to
 * version/status reporting. The session daemon is ready when its own health
 * endpoint serves version information.
 */
export async function probeRunningComponentReady(
  component: RunningComponentId,
  options: Pick<PiWebVersionReportOptions, "configEnv" | "fetch"> = {},
): Promise<boolean> {
  if (component === "sessiond") {
    const sessiond = await collectRunningSessiondInfo();
    return sessiond.component !== undefined;
  }
  const endpoint = webVersionEndpoint(options.configEnv);
  if (endpoint.endpoint === undefined) return false;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  try {
    const response = await fetchImplementation(new URL("./health", endpoint.endpoint).href, {
      signal: AbortSignal.timeout(PI_WEB_VERSION_TIMEOUT_MS),
    });
    if (response.status !== 404) {
      if (!response.ok) return false;
      const health: unknown = await response.json();
      return typeof health === "object" && health !== null && "ok" in health && health.ok === true;
    }
    await fetchPiWebVersionResponse(endpoint.endpoint, fetchImplementation);
    return true;
  } catch (error) {
    const statusEndpoint = statusEndpointFor(endpoint.endpoint);
    if (!isHttpNotFound(error) || statusEndpoint === endpoint.endpoint) return false;
    try {
      await fetchPiWebVersionResponse(statusEndpoint, fetchImplementation);
      return true;
    } catch {
      return false;
    }
  }
}

export function packageVersion(): string {
  return readPackageInfo()?.version ?? DEFAULT_PACKAGE_VERSION;
}

export async function printPiWebVersionReport(options: PiWebVersionReportOptions = {}): Promise<RunningVersionInfo> {
  console.log("PI WEB version");
  printInstalledPackageVersions();
  const runningInfo = await collectRunningVersionInfo(options);
  printRunningVersionInfo(runningInfo);
  return runningInfo;
}

function packageRootPath(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function packageJsonPath(): string {
  return join(packageRootPath(), "package.json");
}

function readPackageInfo(): PackageInfo | undefined {
  const path = packageJsonPath();
  try {
    return parsePackageInfo(JSON.parse(readFileSync(path, "utf8")), path);
  } catch {
    return undefined;
  }
}

function parsePackageInfo(value: unknown, path: string): PackageInfo | undefined {
  if (!isRecord(value)) return undefined;
  const name = value["name"];
  const version = value["version"];
  if (typeof name !== "string" || name === "" || typeof version !== "string" || version === "") return undefined;
  return { name, version, path };
}

function webVersionEndpoint(configEnv: NodeJS.ProcessEnv | undefined): { endpoint?: string; error?: string } {
  try {
    const { config } = effectivePiWebConfig(configEnv === undefined ? {} : { env: configEnv });
    const host = httpClientHost(config.host);
    const port = config.port ?? 8504;
    return { endpoint: `http://${urlHost(host)}:${String(port)}${PI_WEB_VERSION_ENDPOINT_PATH}` };
  } catch (error) {
    return { error: `could not read PI WEB config: ${errorMessage(error)}` };
  }
}

function httpClientHost(configuredHost: string | undefined): string {
  const host = configuredHost === undefined || configuredHost === "" ? "127.0.0.1" : configuredHost;
  if (host === "0.0.0.0" || host === "::" || host === "[::]") return "127.0.0.1";
  return host;
}

function urlHost(host: string): string {
  if (host.startsWith("[") || !host.includes(":")) return host;
  return `[${host}]`;
}

function statusEndpointFor(versionEndpoint: string): string {
  if (!versionEndpoint.endsWith(PI_WEB_VERSION_ENDPOINT_PATH)) return versionEndpoint;
  return `${versionEndpoint.slice(0, -PI_WEB_VERSION_ENDPOINT_PATH.length)}${PI_WEB_STATUS_ENDPOINT_PATH}`;
}

async function fetchPiWebVersionResponse(
  endpoint: string,
  fetchImplementation: typeof globalThis.fetch,
): Promise<PiWebVersionResponse> {
  const response = await fetchImplementation(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(PI_WEB_VERSION_TIMEOUT_MS),
  });
  if (!response.ok) throw new HttpResponseError(response.status);
  const parsed: unknown = await response.json();
  const status = parsePiWebVersionResponse(parsed);
  if (status === undefined) throw new Error("response did not include PI WEB version information");
  return status;
}

async function collectRunningVersionInfo(options: PiWebVersionReportOptions): Promise<RunningVersionInfo> {
  const endpoint = options.webEndpointError === undefined
    ? webVersionEndpoint(options.configEnv)
    : { error: options.webEndpointError };
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (endpoint.endpoint !== undefined) {
    try {
      const status = await fetchPiWebVersionResponse(endpoint.endpoint, fetchImplementation);
      return { generatedAt: status.generatedAt, web: status.components.web, sessiond: status.components.sessiond };
    } catch (error) {
      let webError = `${endpoint.endpoint}: ${errorMessage(error)}`;
      if (isAuthenticationRequired(error)) {
        return runningVersionInfoWithSessiondFallback({ webError, webAuthenticationRequired: true });
      }
      const statusEndpoint = statusEndpointFor(endpoint.endpoint);
      if (statusEndpoint !== endpoint.endpoint && isHttpNotFound(error)) {
        try {
          const status = await fetchPiWebVersionResponse(statusEndpoint, fetchImplementation);
          return { generatedAt: status.generatedAt, web: status.components.web, sessiond: status.components.sessiond };
        } catch (statusError) {
          if (isAuthenticationRequired(statusError)) {
            return runningVersionInfoWithSessiondFallback({
              webError: `${webError}; ${statusEndpoint}: ${errorMessage(statusError)}`,
              webAuthenticationRequired: true,
            });
          }
          webError = `${webError}; ${statusEndpoint}: ${errorMessage(statusError)}`;
        }
      }
      return runningVersionInfoWithSessiondFallback({ webError });
    }
  }

  return runningVersionInfoWithSessiondFallback({ webError: endpoint.error ?? "web/API status endpoint unavailable" });
}

async function runningVersionInfoWithSessiondFallback(base: { webError: string; webAuthenticationRequired?: boolean }): Promise<RunningVersionInfo> {
  const sessiond = await collectRunningSessiondInfo();
  return {
    webError: base.webError,
    ...(base.webAuthenticationRequired === true ? { webAuthenticationRequired: true } : {}),
    ...(sessiond.component === undefined ? {} : { sessiond: sessiond.component }),
    ...(sessiond.error === undefined ? {} : { sessiondError: sessiond.error }),
  };
}

async function collectRunningSessiondInfo(): Promise<{ component?: PiWebComponentStatus; error?: string }> {
  try {
    const response = await withTimeout(
      new SessionDaemonClient().request("GET", "/health"),
      PI_WEB_VERSION_TIMEOUT_MS,
      "session daemon health check timed out",
    );
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`HTTP ${String(response.statusCode)}`);
    const parsed: unknown = response.body === "" ? undefined : JSON.parse(response.body);
    const version = isRecord(parsed) ? parsed["version"] : undefined;
    const component = parsePiWebComponentStatus(version);
    if (component === undefined) throw new Error("health response did not include version information");
    return { component };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function isHttpNotFound(error: unknown): boolean {
  return error instanceof HttpResponseError && error.status === 404;
}

function isAuthenticationRequired(error: unknown): boolean {
  return error instanceof HttpResponseError && (error.status === 401 || error.status === 403);
}

function printInstalledPackageVersions(t: Translator = createTranslator("en", {})): void {
  const info = readPackageInfo();
  console.log(t("version.installed", "Installed packages:"));
  if (info === undefined) {
    console.log(t("version.packageUnknown", "? {arg0}: unknown", { arg0: PI_WEB_PACKAGE_NAME }));
    console.log(t("version.metadataMissing", "  missing package metadata: {arg0}", { arg0: packageJsonPath() }));
    return;
  }
  console.log(`✓ ${info.name}: ${info.version}`);
  console.log(`  ${info.path}`);
}

function printRunningVersionInfo(info: RunningVersionInfo): void {
  console.log("Running services:");
  if (info.web === undefined && info.webAuthenticationRequired === true) {
    console.log("? Web/UI: reachable; authentication required, version unverified");
  } else if (info.web === undefined) printUnavailableComponent("Web/UI", info.webError);
  else printComponentVersion(info.web);
  if (info.sessiond === undefined) printUnavailableComponent("Session daemon", info.sessiondError);
  else printComponentVersion(info.sessiond);
  if (info.generatedAt !== undefined) console.log(`  reported by web/API at ${info.generatedAt}`);
}

function printComponentVersion(component: PiWebComponentStatus, t: Translator = createTranslator("en", {})): void {
  const icon = component.available ? component.stale ? "!" : "✓" : "?";
  const status = !component.available ? t("version.unavailable", "unavailable") : component.stale ? t("version.restartNeeded", "restart needed") : t("version.current", "current");
  console.log(`${icon} ${component.label}: ${status}`);
  if (component.available || component.runtimeVersion !== undefined || component.installedVersion !== undefined) {
    console.log(t("version.runningInstalled", "  running: {arg0}; installed: {arg1}", { arg0: formatVersion(component.runtimeVersion, t), arg1: formatVersion(component.installedVersion, t) }));
  }
  if (component.piVersion !== undefined) console.log(`  pi: ${component.piVersion}`);
  const installation = installationLabel(component.installation);
  if (installation !== undefined) console.log(`  installation: ${installation}`);
  if (component.error !== undefined) console.log(`  ${component.error}`);
}

function printUnavailableComponent(label: string, error: string | undefined, t: Translator = createTranslator("en", {})): void {
  console.log(t("version.componentUnavailable", "? {arg0}: unavailable", { arg0: label }));
  if (error !== undefined && error !== "") console.log(`  ${error}`);
}

function installationLabel(installation: PiWebInstallationInfo | undefined, t: Translator = createTranslator("en", {})): string | undefined {
  if (installation === undefined) return undefined;
  if (installation.kind === "pi-package") {
    const source = installation.source ?? "Pi package";
    const scope = installation.scope === undefined ? "" : ` · ${installation.scope}`;
    const path = installation.path === undefined ? "" : ` · ${installation.path}`;
    return `${source}${scope}${path}`;
  }
  if (installation.kind === "npm-global") {
    const npmRoot = installation.npmRoot === undefined ? "" : ` · ${installation.npmRoot}`;
    const path = installation.path === undefined ? "" : ` · ${installation.path}`;
    return t("version.globalNpm", "global npm package{arg0}{arg1}", { arg0: npmRoot, arg1: path });
  }
  if (installation.kind === "local") return installation.path === undefined ? t("version.checkout", "local checkout") : t("version.checkoutPath", "local checkout · {arg0}", { arg0: installation.path });
  if (installation.kind === "docker") {
    const mode = installation.dockerMode === "dev" ? t("version.dockerDev", "Docker development runtime") : t("version.docker", "Docker runtime");
    return installation.path === undefined ? mode : `${mode} · ${installation.path}`;
  }
  return installation.path === undefined ? t("version.installationUnknown", "installation unknown") : t("version.unknownPath", "installation unknown · {arg0}", { arg0: installation.path });
}

function formatVersion(version: string | undefined, t: Translator = createTranslator("en", {})): string {
  return version === undefined || version === "" ? t("version.unknown", "unknown") : version;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class HttpResponseError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${String(status)}`);
    this.name = "HttpResponseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

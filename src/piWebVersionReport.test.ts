import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  probeRunningComponentReady,
  printPiWebVersionReport,
  runningComponentsReady,
  type RunningVersionInfo,
} from "./piWebVersionReport.js";
import type { PiWebComponentStatus } from "./shared/apiTypes.js";
import { SessionDaemonClient } from "./sessiond/sessionDaemonClient.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function componentStatus(overrides: Partial<PiWebComponentStatus> = {}): PiWebComponentStatus {
  return {
    component: "web",
    label: "Web/UI",
    available: true,
    stale: false,
    ...overrides,
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("local version-report diagnostics", () => {
  it("passes only when every expected reported component is current", () => {
    const current: RunningVersionInfo = {
      web: componentStatus(),
      sessiond: componentStatus({ component: "sessiond", label: "Session daemon" }),
    };
    expect(runningComponentsReady(current, ["web", "sessiond"])).toBe(true);
    expect(runningComponentsReady({ web: componentStatus({ stale: true }) }, ["web"])).toBe(false);
    expect(runningComponentsReady({ sessiondError: "socket missing" }, ["sessiond"])).toBe(false);
  });

  it("treats an authentication-protected web endpoint as reachable without claiming its version is current", () => {
    const info: RunningVersionInfo = {
      webAuthenticationRequired: true,
      webError: "HTTP 401",
    };

    expect(runningComponentsReady(info, ["web"])).toBe(false);
    expect(info.web).toBeUndefined();
  });

  it("ignores unavailable components that are not installed", () => {
    expect(runningComponentsReady({ webError: "connection refused" }, [])).toBe(true);
  });
});

describe("probeRunningComponentReady", () => {
  it("uses the selected service config for both lifecycle readiness and version reporting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-web-readiness-config-"));
    try {
      const configPath = join(dir, "config.json");
      writeFileSync(configPath, JSON.stringify({ host: "127.0.0.1", port: 18504 }));
      const status = { packageName: "@chainingintention/pi-web-cn", generatedAt: new Date().toISOString(), components: { web: componentStatus(), sessiond: componentStatus({ component: "sessiond" }) } };
      const fetchMock = vi.fn<typeof fetch>((input) => Promise.resolve(requestUrl(input).endsWith("/health") ? Response.json({ ok: true }) : Response.json(status)));
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const configEnv = { PI_WEB_CONFIG: configPath };
      expect(await probeRunningComponentReady("web", { configEnv })).toBe(true);
      expect((await printPiWebVersionReport({ configEnv })).web?.available).toBe(true);
      expect(fetchMock.mock.calls).toHaveLength(2);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["http://127.0.0.1:18504/api/pi-web/health", "http://127.0.0.1:18504/api/pi-web/version"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not probe a caller web endpoint after managed config inspection fails", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("unexpected")));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(SessionDaemonClient.prototype, "request").mockRejectedValue(new Error("test daemon unavailable"));
    const result = await printPiWebVersionReport({ webEndpointError: "installed config mismatch" });
    expect(result.webError).toBe("installed config mismatch");
    expect(result.web).toBeUndefined();
    expect(result.webAuthenticationRequired).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not accept normal-auth protection as a readiness response", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("unauthorized", { status: 401 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeRunningComponentReady("web")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not accept unrelated HTTP failures as readiness", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("unavailable", { status: 503 }))));

    await expect(probeRunningComponentReady("web")).resolves.toBe(false);
  });

  it("preserves authentication diagnostics without claiming an unverified version is ready", async () => {
    vi.spyOn(SessionDaemonClient.prototype, "request").mockRejectedValue(new Error("test daemon unavailable"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = await printPiWebVersionReport({ fetch: () => Promise.resolve(new Response("unauthorized", { status: 401 })) });
    expect(result.webAuthenticationRequired).toBe(true);
    expect(result.web).toBeUndefined();
    expect(runningComponentsReady(result, ["web"])).toBe(false);
    expect(log).toHaveBeenCalledWith("? Web/UI: reachable; authentication required, version unverified");
  });
});

function sessiondStatus(overrides: Partial<PiWebComponentStatus> = {}): PiWebComponentStatus {
  return componentStatus({ component: "sessiond", label: "Session daemon", ...overrides });
}

describe("probeRunningComponentReady", () => {
  it("resolves the web endpoint from an injected managed config environment", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-web-version-probe-"));
    const configPath = join(directory, "managed.json");
    writeFileSync(configPath, `${JSON.stringify({ host: "0.0.0.0", port: 9123 })}\n`);
    const requests: string[] = [];
    const fetchImplementation: typeof globalThis.fetch = (input) => {
      requests.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };

    try {
      await expect(probeRunningComponentReady("web", {
        configEnv: { PI_WEB_CONFIG: configPath },
        fetch: fetchImplementation,
      })).resolves.toBe(true);
      expect(requests).toEqual(["http://127.0.0.1:9123/api/pi-web/health"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("falls back to version reporting only for hosts without the health route", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-web-version-probe-"));
    const configPath = join(directory, "managed.json");
    writeFileSync(configPath, JSON.stringify({ host: "127.0.0.1", port: 9123 }));
    const requests: string[] = [];
    const fetchImplementation: typeof globalThis.fetch = (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push(url);
      return Promise.resolve(url.endsWith("/health") ? new Response("Not found", { status: 404 }) : new Response(JSON.stringify({
        packageName: "@chainingintention/pi-web-cn", generatedAt: "2026-08-01T00:00:00.000Z",
        components: { web: componentStatus(), sessiond: sessiondStatus({ available: false }) },
      }), { status: 200 }));
    };
    try {
      await expect(probeRunningComponentReady("web", { configEnv: { PI_WEB_CONFIG: configPath }, fetch: fetchImplementation })).resolves.toBe(true);
      expect(requests).toEqual(["http://127.0.0.1:9123/api/pi-web/health", "http://127.0.0.1:9123/api/pi-web/version"]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("only uses legacy status after both health and version return 404", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-web-version-probe-"));
    const configPath = join(directory, "managed.json");
    writeFileSync(configPath, JSON.stringify({ port: 9123 }));
    const fetchImplementation = vi.fn<typeof fetch>((input) => Promise.resolve(requestUrl(input).endsWith("/status")
      ? Response.json({ packageName: "@chainingintention/pi-web-cn", generatedAt: "2026-08-01T00:00:00.000Z", components: { web: componentStatus(), sessiond: sessiondStatus() } })
      : new Response("Not found", { status: 404 })));
    try {
      expect(await probeRunningComponentReady("web", { configEnv: { PI_WEB_CONFIG: configPath }, fetch: fetchImplementation })).toBe(true);
      expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
        "http://127.0.0.1:9123/api/pi-web/health", "http://127.0.0.1:9123/api/pi-web/version", "http://127.0.0.1:9123/api/pi-web/status",
      ]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("does not accept authentication as readiness when an older host lacks health", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-web-version-probe-"));
    const configPath = join(directory, "managed.json");
    writeFileSync(configPath, JSON.stringify({ port: 9123 }));
    const fetchImplementation = vi.fn<typeof fetch>((input) => Promise.resolve(requestUrl(input).endsWith("/health")
      ? new Response("Not found", { status: 404 }) : new Response("unauthorized", { status: 401 })));
    try {
      expect(await probeRunningComponentReady("web", { configEnv: { PI_WEB_CONFIG: configPath }, fetch: fetchImplementation })).toBe(false);
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it.each([new Response("failed", { status: 503 }), new Response('{"ok":false}'), new Response("not json"), new Response("unauthorized", { status: 401 })])("rejects unhealthy responses without falling back", async (response) => {
    const directory = mkdtempSync(join(tmpdir(), "pi-web-version-probe-"));
    const configPath = join(directory, "managed.json");
    writeFileSync(configPath, JSON.stringify({ port: 9123 }));
    let calls = 0;
    try {
      await expect(probeRunningComponentReady("web", {
        configEnv: { PI_WEB_CONFIG: configPath }, fetch: () => { calls++; return Promise.resolve(response); },
      })).resolves.toBe(false);
      expect(calls).toBe(1);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("does not probe an endpoint when the selected config is malformed", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-web-version-probe-"));
    const configPath = join(directory, "managed.json");
    writeFileSync(configPath, "not json\n");
    let requests = 0;
    const fetchImplementation: typeof globalThis.fetch = () => {
      requests += 1;
      return Promise.reject(new Error("unexpected fetch"));
    };

    try {
      await expect(probeRunningComponentReady("web", {
        configEnv: { PI_WEB_CONFIG: configPath },
        fetch: fetchImplementation,
      })).resolves.toBe(false);
      expect(requests).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("printPiWebVersionReport release checks", () => {
  let directory: string;
  let configEnv: NodeJS.ProcessEnv;
  const npmUrl = "https://registry.npmjs.org/%40chainingintention%2Fpi-web-cn/latest";
  const output = (): string => vi.mocked(console.log).mock.calls.map((args) => args.join(" ")).join("\n");
  const localResponse = (): Response => Response.json({
    packageName: "@chainingintention/pi-web-cn", generatedAt: "2026-08-01T00:00:00.000Z",
    components: { web: componentStatus(), sessiond: sessiondStatus() },
  });
  const reportFetch = (remote: typeof globalThis.fetch) => vi.fn<typeof globalThis.fetch>((input, init) =>
    (typeof input === "string" ? input : input instanceof URL ? input.href : input.url) === npmUrl
      ? remote(input, init) : Promise.resolve(localResponse()));

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "pi-web-release-report-"));
    const configPath = join(directory, "config.json");
    writeFileSync(configPath, JSON.stringify({ port: 9123 }));
    configEnv = { PI_WEB_CONFIG: configPath };
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  });

  it("prints actual per-component engines without confusing package versions", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
      packageName: "@chainingintention/pi-web-cn", generatedAt: "now",
      components: {
        web: componentStatus({ runtimeVersion: "1.202608.1", runtime: { name: "node", version: "22.9.0" } }),
        sessiond: sessiondStatus({ runtimeVersion: "1.202608.1", runtime: { name: "bun", version: "1.3.0" } }),
      },
    }));
    const result = await printPiWebVersionReport({ configEnv, env: {}, fetch });
    expect(result.web?.runtime).toEqual({ name: "node", version: "22.9.0" });
    expect(result.sessiond?.runtime).toEqual({ name: "bun", version: "1.3.0" });
    expect(output()).toContain("runtime: Node.js 22.9.0");
    expect(output()).toContain("runtime: Bun 1.3.0");
    expect(output()).toContain("running: 1.202608.1");
  });

  it.each([undefined, false])("keeps ordinary reports local (check=%s)", async (check) => {
    const remote = vi.fn<typeof globalThis.fetch>();
    const fetch = reportFetch(remote);
    const result = await printPiWebVersionReport({ configEnv, env: {}, fetch, ...(check === undefined ? {} : { check }) });
    expect(result.release).toBeUndefined();
    expect(remote).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(output()).toContain("Running services:");
    expect(output()).not.toContain("Latest npm release:");
  });

  it("prints and returns the latest npm release only on explicit check", async () => {
    const remote = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ version: "1.202612.4" }));
    const result = await printPiWebVersionReport({ check: true, configEnv, env: {}, fetch: reportFetch(remote) });
    expect(result.release).toEqual({ status: "available", latestVersion: "1.202612.4" });
    expect(result.web?.available).toBe(true);
    expect(remote).toHaveBeenCalledTimes(1);
    expect(remote.mock.calls[0]?.[0]).toBe(npmUrl);
    expect(remote.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(output()).toContain("Latest npm release:\n✓ @chainingintention/pi-web-cn: 1.202612.4");
  });

  it.each(["PI_WEB_SKIP_VERSION_CHECK", "PI_WEB_OFFLINE", "PI_SKIP_VERSION_CHECK", "PI_OFFLINE"])("respects %s even on explicit checks", async (key) => {
    const remote = vi.fn<typeof globalThis.fetch>();
    // Existing policy treats any nonempty value, including '0', as disabled.
    const result = await printPiWebVersionReport({ check: true, configEnv, env: { [key]: "0" }, fetch: reportFetch(remote) });
    expect(result.release).toEqual({ status: "skipped", reason: `remote version checks disabled by ${key}` });
    expect(remote).not.toHaveBeenCalled();
    expect(output()).toContain(`skipped: remote version checks disabled by ${key}`);
  });

  it("uses the invoking environment rather than the managed service config environment", async () => {
    vi.stubEnv("PI_WEB_OFFLINE", "1");
    const remote = vi.fn<typeof globalThis.fetch>();
    const result = await printPiWebVersionReport({ check: true, configEnv, fetch: reportFetch(remote) });
    expect(result.release?.status).toBe("skipped");
    expect(remote).not.toHaveBeenCalled();
  });

  it("permits empty policy settings", async () => {
    const result = await printPiWebVersionReport({
      check: true, configEnv, env: { PI_WEB_OFFLINE: "", PI_SKIP_VERSION_CHECK: "" },
      fetch: reportFetch(() => Promise.resolve(Response.json({ version: "1.202612.4" }))),
    });
    expect(result.release?.status).toBe("available");
  });

  it.each([
    ["HTTP error", () => Promise.resolve(new Response("unavailable", { status: 503 })), "npm registry returned HTTP 503"],
    ["missing version", () => Promise.resolve(Response.json({})), "npm registry response did not include a version"],
    ["blank version", () => Promise.resolve(Response.json({ version: "  " })), "npm registry response did not include a version"],
    ["network error", () => Promise.reject(new Error("connection refused")), "connection refused"],
  ] satisfies [string, typeof globalThis.fetch, string][])("makes %s observable without losing local reporting", async (_name, remote, error) => {
    const result = await printPiWebVersionReport({ check: true, configEnv, env: {}, fetch: reportFetch(remote) });
    expect(result.release).toEqual({ status: "error", error });
    expect(result.web?.available).toBe(true);
    expect(output()).toContain(`npm release check failed: ${error}`);
  });

  it("reports invalid JSON instead of claiming a successful check", async () => {
    const result = await printPiWebVersionReport({
      check: true, configEnv, env: {}, fetch: reportFetch(() => Promise.resolve(new Response("not json"))),
    });
    expect(result.release?.status).toBe("error");
    if (result.release?.status === "error") expect(result.release.error.length).toBeGreaterThan(0);
    expect(output()).toContain("npm release check failed:");
  });

  it.each(["request", "body"])("bounds a stalled %s to five seconds and aborts transport", async (stage) => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const remote: typeof globalThis.fetch = (_input, init) => {
      signal = init?.signal;
      if (stage === "request") return new Promise<Response>(() => undefined);
      const response = Response.json({});
      vi.spyOn(response, "json").mockImplementation(() => new Promise(() => undefined));
      return Promise.resolve(response);
    };
    const pending = printPiWebVersionReport({ check: true, configEnv, env: {}, fetch: reportFetch(remote) });
    await vi.advanceTimersByTimeAsync(4999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).release).toEqual({ status: "error", error: "npm registry check timed out after 5000 ms" });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("runningComponentsReady", () => {
  it("passes when nothing is expected even if components are unavailable", () => {
    const info: RunningVersionInfo = { webError: "connection refused", sessiondError: "socket missing" };

    expect(runningComponentsReady(info, [])).toBe(true);
  });

  it("passes when every expected component is available and current", () => {
    const info: RunningVersionInfo = { web: componentStatus(), sessiond: sessiondStatus() };

    expect(runningComponentsReady(info, ["web", "sessiond"])).toBe(true);
  });

  it("fails when an expected component is unavailable", () => {
    const info: RunningVersionInfo = {
      sessiond: sessiondStatus({ available: false, error: "health probe failed" }),
    };

    expect(runningComponentsReady(info, ["sessiond"])).toBe(false);
  });

  it("fails when an expected component is stale (restart needed)", () => {
    const info: RunningVersionInfo = {
      web: componentStatus({ stale: true, runtimeVersion: "1.202608.0", installedVersion: "1.202608.1" }),
    };

    expect(runningComponentsReady(info, ["web"])).toBe(false);
  });

  it("fails when an expected component is absent from the report (error-only entry)", () => {
    const info: RunningVersionInfo = { sessiondError: "connect ENOENT /run/pi-web/sessiond.sock" };

    expect(runningComponentsReady(info, ["sessiond"])).toBe(false);
  });

  it("ignores components that are not expected regardless of their state", () => {
    const info: RunningVersionInfo = {
      web: componentStatus({ available: false, error: "down" }),
      sessiond: sessiondStatus(),
    };

    expect(runningComponentsReady(info, ["sessiond"])).toBe(true);
  });
});

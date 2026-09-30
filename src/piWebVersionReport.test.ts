import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("runningComponentsReady", () => {
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

    expect(runningComponentsReady(info, ["web"])).toBe(true);
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
      const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(status)));
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const configEnv = { PI_WEB_CONFIG: configPath };
      expect(await probeRunningComponentReady("web", { configEnv })).toBe(true);
      expect((await printPiWebVersionReport({ configEnv })).web?.available).toBe(true);
      expect(fetchMock.mock.calls).toHaveLength(2);
      for (const call of fetchMock.mock.calls) expect(call[0]).toBe("http://127.0.0.1:18504/api/pi-web/version");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not probe a caller web endpoint after managed config inspection fails", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("unexpected")));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = await printPiWebVersionReport({ webEndpointError: "installed config mismatch" });
    expect(result.webError).toBe("installed config mismatch");
    expect(result.web).toBeUndefined();
    expect(result.webAuthenticationRequired).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts normal-auth protection as proof that the web service is listening", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("unauthorized", { status: 401 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeRunningComponentReady("web")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not accept unrelated HTTP failures as readiness", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("unavailable", { status: 503 }))));

    await expect(probeRunningComponentReady("web")).resolves.toBe(false);
  });
});

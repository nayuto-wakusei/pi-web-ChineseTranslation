import { afterEach, describe, expect, it, vi } from "vitest";
import {
  probeRunningComponentReady,
  runningComponentsReady,
  type RunningVersionInfo,
} from "./piWebVersionReport.js";
import type { PiWebComponentStatus } from "./shared/apiTypes.js";

afterEach(() => {
  vi.unstubAllGlobals();
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

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebStatusResponse } from "../api";
import { PiWebApp } from "./PiWebApp";
import { PluginStyleRegistry } from "../plugins/styleRegistry";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  localStorage.clear();
});

describe("PiWebApp daemon version retries", () => {
  it("retries unknown versions after five seconds and stops when the daemon recovers", async () => {
    vi.useFakeTimers();
    const app = createApp();
    vi.spyOn(app, "isConnected", "get").mockReturnValue(true);
    const unavailable = status(false);
    Reflect.set(app, "state", { piWebStatus: unavailable });
    const refresh = vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(() => {
      Reflect.set(app, "state", { piWebStatus: status(true) });
      return Promise.resolve();
    });
    Reflect.set(app, "piWebStatusController", { refresh });

    call(app, "schedulePiWebStatusRetry");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not schedule retries after the app disconnects", () => {
    vi.useFakeTimers();
    const app = createApp();
    Reflect.set(app, "state", { piWebStatus: status(false) });
    call(app, "schedulePiWebStatusRetry");
    expect(vi.getTimerCount()).toBe(0);
  });
});

function createApp(): PiWebApp {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", { location: { search: "" }, localStorage: storage, setTimeout, clearTimeout });
  vi.spyOn(PluginStyleRegistry.prototype, "setContributions").mockResolvedValue(undefined);
  return new PiWebApp();
}

function call(app: PiWebApp, name: string): void {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`${name} is not callable`);
  Reflect.apply(method, app, []);
}

function status(available: boolean): PiWebStatusResponse {
  return {
    packageName: "@jmfederico/pi-web",
    generatedAt: "2026-10-27T00:00:00Z",
    components: {
      web: { component: "web", label: "Web/UI", stale: false, available: true },
      sessiond: { component: "sessiond", label: "Session daemon", stale: false, available },
    },
    release: { packageName: "@jmfederico/pi-web", updateAvailable: false },
    commands: {},
    messages: [],
  };
}

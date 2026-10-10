import { describe, expect, it, vi } from "vitest";
import { runSessionDaemonStartup } from "./sessionDaemonStartup.js";

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("session daemon startup cleanup", () => {
  it("releases constructed resources in reverse order and preserves the original failure", async () => {
    const events: string[] = [];
    const constructionFailure = new Error("runtime construction failed");
    const cleanupFailure = new Error("resource cleanup failed");
    const startupLogger = logger();
    const registerRoutes = vi.fn();
    const listen = vi.fn(() => Promise.resolve());

    await expect(runSessionDaemonStartup({
      logger: startupLogger,
      createRuntime: (registerCleanup) => {
        registerCleanup(() => { events.push("ownership"); });
        registerCleanup(() => { events.push("server"); });
        registerCleanup(() => { events.push("resource"); throw cleanupFailure; });
        throw constructionFailure;
      },
      registerRoutes,
      listen,
      disposeRuntime: vi.fn(),
    })).rejects.toBe(constructionFailure);

    expect(events).toEqual(["resource", "server", "ownership"]);
    expect(startupLogger.error).toHaveBeenCalledWith(
      { err: cleanupFailure }, "session daemon construction cleanup failed",
    );
    expect(registerRoutes).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it.each(["routes", "listen"] as const)("disposes the completed runtime after a %s failure", async (failingStep) => {
    const failure = new Error("startup failed");
    const runtime = { id: "runtime" };
    const cleanup = vi.fn();
    const disposeRuntime = vi.fn(() => Promise.resolve());

    await expect(runSessionDaemonStartup({
      logger: logger(),
      createRuntime: (registerCleanup) => { registerCleanup(cleanup); return runtime; },
      registerRoutes: () => { if (failingStep === "routes") throw failure; },
      listen: () => failingStep === "listen" ? Promise.reject(failure) : Promise.resolve(),
      disposeRuntime,
    })).rejects.toBe(failure);

    expect(disposeRuntime).toHaveBeenCalledExactlyOnceWith(runtime);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("logs disposal failure without hiding the startup failure", async () => {
    const failure = new Error("listen failed");
    const disposalFailure = new Error("disposal failed");
    const startupLogger = logger();

    await expect(runSessionDaemonStartup({
      logger: startupLogger,
      createRuntime: () => ({}),
      registerRoutes: () => undefined,
      listen: () => Promise.reject(failure),
      disposeRuntime: () => Promise.reject(disposalFailure),
    })).rejects.toBe(failure);

    expect(startupLogger.error).toHaveBeenCalledWith(
      { err: disposalFailure }, "session daemon startup cleanup failed",
    );
  });

  it("leaves a successful runtime alive", async () => {
    const runtime = { id: "runtime" };
    const events: string[] = [];
    const cleanup = vi.fn();
    const disposeRuntime = vi.fn();
    const result = await runSessionDaemonStartup<typeof runtime>({
      logger: logger(),
      createRuntime: (registerCleanup) => { registerCleanup(cleanup); events.push("runtime"); return runtime; },
      registerRoutes: () => { events.push("routes"); },
      listen: () => { events.push("listen"); return Promise.resolve(); },
      disposeRuntime,
    });

    expect(result).toBe(runtime);
    expect(events).toEqual(["runtime", "routes", "listen"]);
    expect(cleanup).not.toHaveBeenCalled();
    expect(disposeRuntime).not.toHaveBeenCalled();
  });
});

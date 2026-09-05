import { afterEach, describe, expect, it, vi } from "vitest";
import { terminalsApi, type Workspace } from "../api";
import { HttpRequestError } from "../api/http";
import { BrowserErrorReporter, workspaceBrowserErrorScope } from "../browserErrors";
import { MachineStatusController } from "../controllers/machineStatusController";
import { ServerNoticesController } from "../serverNotices";
import { RealtimeSocket } from "../sessionSocket";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp connection lifecycle", () => {
  it("starts authenticated resources again after disconnecting and reconnecting", () => {
    const app = createConnectedApp();
    const connectRealtime = replaceMethod(app, "connectRealtime", vi.fn());
    replaceMethod(app, "refreshWorkspaceActivity", () => Promise.resolve());
    replaceMethod(app, "refreshMachineStatusSnapshots", () => Promise.resolve());
    replaceMethod(app, "loadClientConfig", () => Promise.resolve());
    replaceMethod(app, "ensureGatewayPluginsLoaded", () => Promise.resolve());
    replaceMethod(app, "loadProjectsAndRestoreRoute", () => Promise.resolve());
    replaceMethod(app, "schedulePiWebStatusRefresh", vi.fn());
    replaceMethod(app, "clearScheduledPiWebStatusRefresh", vi.fn());
    replaceMethod(app, "clearPendingRemoteRouteRestore", vi.fn());
    replaceMethod(app, "closeMachineActivitySockets", vi.fn());

    callMethod(app, "startAuthenticatedApp");
    callMethod(app, "startAuthenticatedApp");
    expect(connectRealtime).toHaveBeenCalledOnce();

    app.disconnectedCallback();
    Object.defineProperty(app, "isConnected", { value: true, configurable: true });
    callMethod(app, "startAuthenticatedApp");

    expect(connectRealtime).toHaveBeenCalledTimes(2);
  });

  it("ignores an auth response from an obsolete connection", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    const app = createConnectedApp();
    const startAuthenticatedApp = replaceMethod(app, "startAuthenticatedApp", vi.fn());
    Reflect.set(app, "normalAuthInitSeq", 1);

    const initializing = callAsyncMethod(app, "initializeNormalAuth", 1);
    Object.defineProperty(app, "isConnected", { value: false, configurable: true });
    Reflect.set(app, "normalAuthInitSeq", 2);
    resolveFetch?.(new Response(JSON.stringify({ configured: true, authenticated: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await initializing;

    expect(Reflect.get(app, "normalAuthStatus")).toBeUndefined();
    expect(startAuthenticatedApp).not.toHaveBeenCalled();
  });

  it("does not refresh interactive terminals in management embed mode", async () => {
    const app = createConnectedApp("?embed=management");
    const terminals = vi.spyOn(terminalsApi, "terminals");

    await callAsyncMethod(app, "refreshActiveTerminals", workspace);

    expect(terminals).not.toHaveBeenCalled();
  });

  it.each(["", "?embed=management"])("refreshes server notices on reconnect only in normal mode (%s)", (search) => {
    const app = createConnectedApp(search);
    const refreshNotices = vi.spyOn(ServerNoticesController.prototype, "refresh").mockResolvedValue(undefined);
    vi.spyOn(RealtimeSocket.prototype, "connect").mockImplementation((_onEvent, onOpen) => { onOpen?.(); });
    vi.spyOn(MachineStatusController.prototype, "refresh").mockResolvedValue(undefined);
    replaceMethod(app, "renegotiateUnreadMachine", () => Promise.resolve());
    replaceMethod(app, "refreshWorkspaceActivity", () => Promise.resolve());

    callMethod(app, "connectRealtime");

    expect(refreshNotices).toHaveBeenCalledTimes(search === "" ? 1 : 0);
  });

  it("reports management workspace removal errors without fetching server notices", async () => {
    const app = createConnectedApp("?embed=management");
    const refreshNotices = vi.spyOn(ServerNoticesController.prototype, "refresh").mockResolvedValue(undefined);
    const reportError = vi.spyOn(BrowserErrorReporter.prototype, "report").mockImplementation(() => undefined);
    const scope = workspaceBrowserErrorScope("local", workspace.projectId, workspace.id);

    await callAsyncMethod(app, "reportWorkspaceRemovalFailure", workspace, "local", scope, new HttpRequestError("denied", 403));

    expect(refreshNotices).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(scope, expect.stringContaining("denied"));
  });

  it("does not resume polling when an in-flight refresh finishes after disconnect", async () => {
    const app = createPollingApp();
    const refresh = deferredRefresh();
    const refreshSelectedTranscript = replaceMethod(app, "refreshSelectedTranscript", vi.fn(() => refresh.promise));

    callMethod(app, "scheduleSelectedSessionRefresh");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refreshSelectedTranscript).toHaveBeenCalledOnce();

    Object.defineProperty(app, "isConnected", { value: false, configurable: true });
    app.disconnectedCallback();
    refresh.resolve();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(refreshSelectedTranscript).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the new connection's poll scheduled when an obsolete refresh finishes", async () => {
    const app = createPollingApp();
    const refresh = deferredRefresh();
    const refreshSelectedTranscript = replaceMethod(app, "refreshSelectedTranscript", vi.fn()
      .mockImplementationOnce(() => refresh.promise)
      .mockResolvedValue(undefined));

    callMethod(app, "scheduleSelectedSessionRefresh");
    await vi.advanceTimersByTimeAsync(5_000);
    app.disconnectedCallback();
    Reflect.set(app, "authenticatedAppRunning", true);
    callMethod(app, "scheduleSelectedSessionRefresh");
    await vi.advanceTimersByTimeAsync(2_000);
    refresh.resolve();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(refreshSelectedTranscript).toHaveBeenCalledTimes(2);
    app.disconnectedCallback();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function createPollingApp(): PiWebApp {
  vi.useFakeTimers();
  const app = createConnectedApp();
  Reflect.set(window, "setTimeout", setTimeout);
  Reflect.set(window, "clearTimeout", clearTimeout);
  Reflect.set(app, "authenticatedAppRunning", true);
  return app;
}

function deferredRefresh(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

const workspace: Workspace = {
  id: "workspace-1",
  projectId: "project-1",
  path: "/repo",
  label: "repo",
  isMain: true,
  isGitRepo: true,
  isGitWorktree: false,
};

function createConnectedApp(search = ""): PiWebApp {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", {
    location: { search },
    localStorage: storage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
  });
  const app = new PiWebApp();
  Object.defineProperty(app, "isConnected", { value: true, configurable: true });
  return app;
}

function replaceMethod<F extends (...args: never[]) => unknown>(target: object, name: string, replacement: F): F {
  if (!Reflect.set(target, name, replacement)) throw new Error(`Could not replace ${name}`);
  return replacement;
}

type Callable = (this: object, ...args: unknown[]) => unknown;

function method(target: object, name: string): Callable {
  const value: unknown = Reflect.get(target, name);
  if (!isCallable(value)) throw new Error(`${name} is not callable`);
  return value;
}

function isCallable(value: unknown): value is Callable {
  return typeof value === "function";
}

function callMethod(target: object, name: string): void {
  method(target, name).call(target);
}

async function callAsyncMethod(target: object, name: string, ...args: unknown[]): Promise<void> {
  await method(target, name).call(target, ...args);
}

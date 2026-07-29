import { afterEach, describe, expect, it, vi } from "vitest";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp connection lifecycle", () => {
  it("starts authenticated resources again after disconnecting and reconnecting", () => {
    const app = createConnectedApp();
    const connectRealtime = replaceMethod(app, "connectRealtime", vi.fn());
    replaceMethod(app, "refreshWorkspaceActivity", () => Promise.resolve());
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
});

function createConnectedApp(): PiWebApp {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", {
    location: { search: "" },
    localStorage: storage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
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

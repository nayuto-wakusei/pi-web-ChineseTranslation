import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderClaim, WorkspaceProvider } from "../../server-plugin-api.js";
import type { Project } from "../types.js";
import { WorkspaceProviderRegistry } from "./workspaceProviderRegistry.js";

const project: Project = { id: "project", name: "Project", path: resolve("repo"), createdAt: "now" };

afterEach(() => { vi.useRealTimers(); });

function registry(provider: WorkspaceProvider): WorkspaceProviderRegistry {
  return new WorkspaceProviderRegistry({
    logger: { warn: vi.fn() },
    pathInspector: () => true,
    providerTimeoutMs: 100,
    requestTimeoutMs: 100,
    contributions: [{
      pluginId: "owner", pluginName: "Owner", packageRoot: "/plugins/owner", source: "fixture",
      scope: "local", moduleRevision: "1", provider,
    }],
  });
}

describe("workspace provider shutdown", () => {
  it("advertises removal only for the individual workspace presenting it", async () => {
    const providers = registry({
      probe: () => Promise.resolve("claim"),
      list: () => Promise.resolve([
        { key: "main", path: project.path, label: "Main", isMain: true },
        { key: "feature", path: resolve("repo-feature"), label: "Feature", isMain: false, removal: { actionLabel: "Remove", confirmation: "Remove?" } },
      ]),
      prepareRemove: () => Promise.resolve({ title: "Remove", command: "true" }),
    });
    try {
      const result = await providers.resolve(project);
      expect(result.workspaces.map((workspace) => workspace.provider?.capabilities.remove)).toEqual([false, true]);
    } finally {
      await providers.closeAll();
    }
  });
  it("cancels admitted work, drains the raw callback, and rejects new work", async () => {
    const started = deferred<boolean>();
    const callback = deferred<ProviderClaim>();
    let callbackSignal: AbortSignal | undefined;
    const providers = registry({
      probe: (_project, signal) => { callbackSignal = signal; started.resolve(true); return callback.promise; },
      list: () => Promise.resolve([]),
    });
    const resolution = providers.resolve(project);
    const rejected = expect(resolution).rejects.toMatchObject({ name: "AbortError" });
    await started.promise;

    let closed = false;
    const closing = providers.closeAll();
    void closing.then(() => { closed = true; });
    expect(providers.closeAll()).toBe(closing);
    await rejected;
    expect(callbackSignal?.aborted).toBe(true);
    expect(closed).toBe(false);
    await expect(providers.resolve(project)).rejects.toMatchObject({ name: "AbortError" });
    await expect(providers.resolveRemoval(project, "workspace")).rejects.toMatchObject({ name: "AbortError" });
    await expect(providers.request({
      project, pluginId: "owner", moduleRevision: "1", workspaceId: "workspace", operation: "read", input: {},
    })).rejects.toMatchObject({ name: "AbortError" });

    callback.resolve("pass");
    await closing;
    expect(closed).toBe(true);
  });

  it("reports an uncooperative callback after a bounded drain", async () => {
    vi.useFakeTimers();
    const started = deferred<boolean>();
    const providers = registry({
      probe: () => { started.resolve(true); return new Promise<ProviderClaim>(() => undefined); },
      list: () => Promise.resolve([]),
    });
    const resolution = providers.resolve(project);
    const rejected = expect(resolution).rejects.toMatchObject({ name: "AbortError" });
    await started.promise;
    const closing = providers.closeAll();
    const failedDrain = expect(closing).rejects.toThrow("Workspace provider callbacks did not settle within 100ms");
    await rejected;
    await vi.advanceTimersByTimeAsync(100);
    await failedDrain;
  });

  it("isolates a caller's cancellation from a shared uncancellable resolution", async () => {
    const callbacks = [deferred<ProviderClaim>(), deferred<ProviderClaim>()];
    const started = deferred<boolean>();
    const signals: AbortSignal[] = [];
    const providers = registry({
      probe: (_project, signal) => {
        signals.push(signal);
        if (signals.length === 2) started.resolve(true);
        const callback = callbacks[signals.length - 1];
        if (callback === undefined) throw new Error("Unexpected extra resolution");
        return callback.promise;
      },
      list: () => Promise.resolve([]),
    });
    const shared = providers.resolve(project);
    const controller = new AbortController();
    const cancelled = providers.resolve(project, controller.signal);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await started.promise;
    controller.abort(new DOMException("Caller left", "AbortError"));
    await rejected;
    expect(signals[0]?.aborted).toBe(false);
    expect(signals[1]?.aborted).toBe(true);
    callbacks[0]?.resolve("pass");
    callbacks[1]?.resolve("pass");
    await expect(shared).resolves.toMatchObject({ status: "folder", projectId: project.id });
    await providers.closeAll();
  });
});

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolveDeferred) => { resolvePromise = resolveDeferred; });
  return { promise, resolve: resolvePromise };
}

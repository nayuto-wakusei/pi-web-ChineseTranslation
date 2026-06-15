import { describe, expect, it, vi } from "vitest";
import type { PiWebStatusResponse } from "../shared/apiTypes.js";
import { createPiWebStatusCache } from "./piWebStatusCache.js";

describe("createPiWebStatusCache", () => {
  it("serves cached status while it is fresh", async () => {
    const now = 1_000;
    const load = vi.fn(() => Promise.resolve(status("first")));
    const cache = createPiWebStatusCache(load, { ttlMs: 100, now: () => now });

    await expect(cache.get()).resolves.toMatchObject({ generatedAt: "first" });
    await expect(cache.get()).resolves.toMatchObject({ generatedAt: "first" });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("returns stale status immediately while refreshing in the background", async () => {
    let now = 1_000;
    const load = vi.fn()
      .mockResolvedValueOnce(status("first"))
      .mockResolvedValueOnce(status("second"));
    const cache = createPiWebStatusCache(load, { ttlMs: 100, now: () => now });

    await expect(cache.get()).resolves.toMatchObject({ generatedAt: "first" });
    now = 1_101;

    await expect(cache.get()).resolves.toMatchObject({ generatedAt: "first" });
    await waitForMicrotasks();

    await expect(cache.get()).resolves.toMatchObject({ generatedAt: "second" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent cold loads", async () => {
    const deferred = createDeferred<PiWebStatusResponse>();
    const load = vi.fn(() => deferred.promise);
    const cache = createPiWebStatusCache(load);

    const first = cache.get();
    const second = cache.get();
    deferred.resolve(status("ready"));

    await expect(first).resolves.toMatchObject({ generatedAt: "ready" });
    await expect(second).resolves.toMatchObject({ generatedAt: "ready" });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

function status(generatedAt: string): PiWebStatusResponse {
  return {
    packageName: "@jmfederico/pi-web",
    generatedAt,
    components: {
      web: { component: "web", label: "Web/UI", stale: false, available: true },
      sessiond: { component: "sessiond", label: "Session daemon", stale: false, available: true },
    },
    release: { packageName: "@jmfederico/pi-web", updateAvailable: false },
    commands: {},
    messages: [],
  };
}

async function waitForMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { browserStorage } from "./browserStorage";
import { MemoryStorage } from "./browserStorage.testSupport";

afterEach(() => { vi.unstubAllGlobals(); });

describe("browserStorage", () => {
  it("reads the current storage without caching it", () => {
    for (const storage of [new MemoryStorage(), undefined, new MemoryStorage()]) {
      vi.stubGlobal("localStorage", storage);
      expect(browserStorage()).toBe(storage);
    }
  });

  it("tolerates browsers denying access to local storage", () => {
    vi.stubGlobal("localStorage", undefined);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("Storage access denied"); },
    });
    expect(browserStorage()).toBeUndefined();
  });
});

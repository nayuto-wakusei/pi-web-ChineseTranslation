import { describe, expect, it, vi } from "vitest";
import { GitStatusCache } from "./gitService";

describe("GitStatusCache", () => {
  it("shares pending work, caches for two seconds and permits explicit refresh", async () => {
    let now = 0;
    const scan = vi.fn(() => Promise.resolve({ isGitRepo: true, hash: "h", files: [], submodules: [] }));
    const cache = new GitStatusCache(scan, () => now);
    await Promise.all(Array.from({ length: 20 }, () => cache.get("normal:p:w", "/repo")));
    expect(scan).toHaveBeenCalledTimes(1);
    now = 1999;
    await cache.get("normal:p:w", "/repo");
    expect(scan).toHaveBeenCalledTimes(1);
    now = 2000;
    await cache.get("normal:p:w", "/repo");
    await cache.get("normal:p:w", "/repo", true);
    await cache.get("management:u:p:w", "/repo");
    expect(scan).toHaveBeenCalledTimes(4);
  });
});

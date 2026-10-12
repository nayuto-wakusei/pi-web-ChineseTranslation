import { describe, expect, it, vi } from "vitest";
import { GitStatusCache } from "./gitStatusCache.js";

describe("GitStatusCache", () => {
  it("shares pending work, caches for two seconds and permits explicit refresh", async () => {
    let now = 0;
    const scan = vi.fn(() => Promise.resolve({ isGitRepo: true, hash: "h", files: [], submodules: [] }));
    const cache = new GitStatusCache(scan, () => now);
    const signal = new AbortController().signal;
    await Promise.all(Array.from({ length: 20 }, () => cache.get("normal:p:w", "/repo", signal)));
    expect(scan).toHaveBeenCalledTimes(1);
    now = 1999;
    await cache.get("normal:p:w", "/repo", signal);
    expect(scan).toHaveBeenCalledTimes(1);
    now = 2000;
    await cache.get("normal:p:w", "/repo", signal);
    await cache.get("normal:p:w", "/repo", signal, true);
    await cache.get("management:u:p:w", "/repo", signal);
    expect(scan).toHaveBeenCalledTimes(4);
  });

  it("joins an in-flight refresh only for the same cancellation owner without scheduling trailing work", async () => {
    let complete!: (value: { isGitRepo: boolean; hash: string; files: never[]; submodules: never[] }) => void;
    const scan = vi.fn(() => new Promise<{ isGitRepo: boolean; hash: string; files: never[]; submodules: never[] }>((resolve) => { complete = resolve; }));
    const cache = new GitStatusCache(scan);
    const signal = new AbortController().signal;
    const first = cache.get("workspace", "/repo", signal);
    expect(cache.get("workspace", "/repo", signal, true)).toBe(first);
    await Promise.resolve();
    complete({ isGitRepo: true, hash: "latest", files: [], submodules: [] });
    await first;
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("does not couple cancellation owners or let an older scan replace a newer snapshot", async () => {
    const completions: ((value: { isGitRepo: boolean; hash: string; files: never[]; submodules: never[] }) => void)[] = [];
    const scan = vi.fn(() => new Promise<{ isGitRepo: boolean; hash: string; files: never[]; submodules: never[] }>((resolve) => { completions.push(resolve); }));
    const cache = new GitStatusCache(scan);
    const abandoned = new AbortController();
    const signal = new AbortController().signal;
    const first = cache.get("workspace", "/repo", abandoned.signal);
    const second = cache.get("workspace", "/repo", signal);
    const rejected = expect(first).rejects.toThrow("cancelled");
    await Promise.resolve();
    abandoned.abort(new Error("cancelled"));
    const [completeFirst, completeSecond] = completions;
    if (completeFirst === undefined || completeSecond === undefined) throw new Error("Expected two independent scans");
    completeSecond({ isGitRepo: true, hash: "new", files: [], submodules: [] });
    await second;
    completeFirst({ isGitRepo: true, hash: "old", files: [], submodules: [] });
    await rejected;
    expect((await cache.get("workspace", "/repo", signal)).hash).toBe("new");
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("invalidates completed snapshots on refresh failures and never caches missing repositories", async () => {
    const status = { isGitRepo: true, hash: "old", files: [], submodules: [] };
    const scan = vi.fn().mockResolvedValueOnce(status).mockRejectedValueOnce(new Error("git failed"))
      .mockResolvedValueOnce({ ...status, isGitRepo: false }).mockResolvedValueOnce({ ...status, hash: "restored" });
    const cache = new GitStatusCache(scan);
    const signal = new AbortController().signal;
    await cache.get("workspace", "/repo", signal);
    await expect(cache.get("workspace", "/repo", signal, true)).rejects.toThrow("git failed");
    expect((await cache.get("workspace", "/repo", signal)).isGitRepo).toBe(false);
    expect((await cache.get("workspace", "/repo", signal)).hash).toBe("restored");
    expect(scan).toHaveBeenCalledTimes(4);
  });
});

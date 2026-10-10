import { afterEach, describe, expect, it, vi } from "vitest";
import { TrailingRefreshCoordinator } from "./trailingRefreshCoordinator";

afterEach(() => { vi.useRealTimers(); });

describe("TrailingRefreshCoordinator", () => {
  it("rejects invalid quiet periods", () => {
    for (const delay of [-1, 0.5, NaN]) expect(() => new TrailingRefreshCoordinator(delay)).toThrow();
  });

  it("shares same-task work using the latest refresh callback", async () => {
    const coordinator = new TrailingRefreshCoordinator<string>();
    const first = vi.fn(() => Promise.resolve());
    const latest = vi.fn(() => Promise.resolve());
    const pending = coordinator.request("project", first);
    expect(coordinator.request("project", latest)).toBe(pending);
    await pending;
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it("restarts the initial quiet period without coupling different keys", async () => {
    vi.useFakeTimers();
    const coordinator = new TrailingRefreshCoordinator<string>(50);
    const refresh = vi.fn(() => Promise.resolve());
    const other = vi.fn(() => Promise.resolve());
    const pending = coordinator.request("first", refresh);
    const independent = coordinator.request("other", other);
    await vi.advanceTimersByTimeAsync(40);
    void coordinator.request("first", refresh);
    await vi.advanceTimersByTimeAsync(10);
    expect(other).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40);
    await Promise.all([pending, independent]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("debounces trailing requests and runs another pass requested during that pass", async () => {
    vi.useFakeTimers();
    const coordinator = new TrailingRefreshCoordinator<string>(50);
    const resolve: (() => void)[] = [];
    const refresh = vi.fn(() => new Promise<void>((done) => { resolve.push(done); }));
    const pending = coordinator.request("project", refresh);
    await vi.advanceTimersByTimeAsync(50);
    void coordinator.request("project", refresh);
    void coordinator.request("project", refresh);
    resolve[0]?.();
    await vi.advanceTimersByTimeAsync(40);
    void coordinator.request("project", refresh);
    await vi.advanceTimersByTimeAsync(49);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    void coordinator.request("project", refresh);
    resolve[1]?.();
    await vi.advanceTimersByTimeAsync(50);
    expect(refresh).toHaveBeenCalledTimes(3);
    resolve[2]?.();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows a successful trailing pass to recover a failed request and releases the key", async () => {
    const coordinator = new TrailingRefreshCoordinator<string>();
    let fail: ((reason: Error) => void) | undefined;
    const initial = () => new Promise<void>((_resolve, reject) => { fail = reject; });
    const latest = vi.fn(() => Promise.resolve());
    const pending = coordinator.request("project", initial);
    await Promise.resolve();
    void coordinator.request("project", latest);
    fail?.(new Error("initial failure"));
    await expect(pending).resolves.toBeUndefined();
    await coordinator.request("project", latest);
    expect(latest).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequestError, NetworkRequestError } from "../api/http";
import { readWithNetworkRecovery } from "./networkReadRecovery";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Promise not initialized"); };
  let reject: (error: unknown) => void = () => { throw new Error("Promise not initialized"); };
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("readWithNetworkRecovery", () => {
  it("does not retry ordinary reads and removes abort listeners after success, failure, and retirement", async () => {
    for (const settlement of ["success", "failure", "retired"] as const) {
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, "addEventListener");
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const gate = deferred<string>();
      const read = vi.fn(() => gate.promise);
      const pending = readWithNetworkRecovery(read, () => true, controller.signal, false);
      const observed = pending.catch((error: unknown) => error);
      if (settlement === "success") gate.resolve("ready");
      else if (settlement === "failure") gate.reject(new NetworkRequestError("offline"));
      else controller.abort();
      await observed;
      expect(read).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(add).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0]?.[1]);
      if (settlement === "retired") gate.reject(new Error("retired failure"));
    }
  });
  it.each([500, 1500, 3000])("actively clears a %ims backoff and settles on cancellation", async (delay) => {
    const controller = new AbortController();
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(new NetworkRequestError("offline"));
    const pending = readWithNetworkRecovery(read, () => true, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    for (const earlier of [500, 1500, 3000].slice(0, [500, 1500, 3000].indexOf(delay))) await vi.advanceTimersByTimeAsync(earlier);
    expect(vi.getTimerCount()).toBe(1);
    const attempts = read.mock.calls.length;
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(read).toHaveBeenCalledTimes(attempts);
  });

  it.each(["success", "failure"])("settles a hung read on abort and consumes its late %s", async (settlement) => {
    const controller = new AbortController();
    const gate = deferred<string>();
    const read = vi.fn(() => gate.promise);
    const pending = readWithNetworkRecovery(read, () => true, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    if (settlement === "success") gate.resolve("late");
    else gate.reject(new NetworkRequestError("late"));
    await Promise.resolve();
    expect(read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("returns a successful read without scheduling a retry", async () => {
    const result = { value: "ready" };
    const read = vi.fn<() => Promise<typeof result>>().mockResolvedValue(result);

    await expect(readWithNetworkRecovery(read, () => true)).resolves.toBe(result);

    expect(read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows only three retries at 500, 1500, and 3000ms and throws the final failure", async () => {
    const finalFailure = new NetworkRequestError("Still offline", { cause: new TypeError("Offline") });
    const read = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new NetworkRequestError("First failure"))
      .mockRejectedValueOnce(new NetworkRequestError("Second failure"))
      .mockRejectedValueOnce(new NetworkRequestError("Third failure"))
      .mockRejectedValue(finalFailure);
    const outcome = expect(readWithNetworkRecovery(read, () => true)).rejects.toBe(finalFailure);

    expect(read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    for (const [index, delay] of [500, 1500, 3000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(read).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(read).toHaveBeenCalledTimes(index + 2);
    }

    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([1, 2, 3])("returns success after %i network retries", async (retryCount) => {
    const read = vi.fn<() => Promise<string>>().mockResolvedValue("recovered");
    for (let index = 0; index < retryCount; index += 1) {
      read.mockRejectedValueOnce(new NetworkRequestError("Offline"));
    }
    const outcome = expect(readWithNetworkRecovery(read, () => true)).resolves.toBe("recovered");

    await vi.runAllTimersAsync();

    await outcome;
    expect(read).toHaveBeenCalledTimes(retryCount + 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { label: "HTTP authorization", failure: new HttpRequestError("Unauthorized", 401) },
    { label: "HTTP server", failure: new HttpRequestError("Service Unavailable", 503) },
    { label: "JSON syntax", failure: new SyntaxError("Invalid JSON") },
    { label: "parser TypeError", failure: new TypeError("Invalid shape") },
    { label: "programmer", failure: new Error("Bug") },
    { label: "cancellation", failure: new DOMException("Cancelled", "AbortError") },
  ])("throws $label errors without retrying while current", async ({ failure }) => {
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(failure);

    await expect(readWithNetworkRecovery(read, () => true)).rejects.toBe(failure);

    expect(read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry a synchronous programmer error", async () => {
    const failure = new TypeError("Bug");
    const read = vi.fn<() => Promise<string>>(() => { throw failure; });

    await expect(readWithNetworkRecovery(read, () => true)).rejects.toBe(failure);

    expect(read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops retrying if a subsequent attempt has a non-network error", async () => {
    const failure = new HttpRequestError("Service Unavailable", 503);
    const read = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new NetworkRequestError("Offline"))
      .mockRejectedValue(failure);
    const outcome = expect(readWithNetworkRecovery(read, () => true)).rejects.toBe(failure);

    await vi.runAllTimersAsync();

    await outcome;
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a read when the context is already retired", async () => {
    const read = vi.fn<() => Promise<string>>().mockResolvedValue("stale");

    await expect(readWithNetworkRecovery(read, () => false)).resolves.toBeUndefined();

    expect(read).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["success", "network failure", "other failure", "cancellation"])("discards in-flight %s after context retirement", async (settlement) => {
    const pending = deferred<string>();
    const read = vi.fn(() => pending.promise);
    const controller = new AbortController();
    const outcome = expect(readWithNetworkRecovery(read, () => !controller.signal.aborted)).resolves.toBeUndefined();
    controller.abort();

    if (settlement === "success") pending.resolve("stale");
    else if (settlement === "network failure") pending.reject(new NetworkRequestError("Offline"));
    else if (settlement === "cancellation") pending.reject(new DOMException("Cancelled", "AbortError"));
    else pending.reject(new HttpRequestError("Unauthorized", 401));

    await outcome;
    expect(read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 1, 2])("does not read again when retired during retry delay %i", async (retryIndex) => {
    let current = true;
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(new NetworkRequestError("Offline"));
    const outcome = expect(readWithNetworkRecovery(read, () => current)).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of [500, 1500, 3000].slice(0, retryIndex)) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(read).toHaveBeenCalledTimes(retryIndex + 1);
    current = false;

    await vi.runAllTimersAsync();

    await outcome;
    expect(read).toHaveBeenCalledTimes(retryIndex + 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards the final network failure when retired during the last attempt", async () => {
    let current = true;
    const pending = deferred<string>();
    const read = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new NetworkRequestError("First failure"))
      .mockRejectedValueOnce(new NetworkRequestError("Second failure"))
      .mockRejectedValueOnce(new NetworkRequestError("Third failure"))
      .mockReturnValueOnce(pending.promise);
    const outcome = expect(readWithNetworkRecovery(read, () => current)).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    expect(read).toHaveBeenCalledTimes(4);
    current = false;

    pending.reject(new NetworkRequestError("Final failure"));

    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchClient } from "./workbenchClient.js";

afterEach(() => vi.restoreAllMocks());

const request = { resourceName: "bookstack.gx.1", entityType: "book" as const };

describe("Workbench request cancellation", () => {
  it.each(["headers", "body"] as const)("reports the local deadline during %s without replay or sensitive data", async (stage) => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      if (stage === "headers") return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error("Unexpected non-error abort"));
        }, { once: true });
      });
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => { controller.error(init.signal?.reason); }, { once: true });
        },
      })));
    });
    const client = new WorkbenchClient({ baseUrl: "https://private-workbench", requestTimeoutMs: 12_345, fetch: fetchImpl });
    const pending = client.readBookstack("private-token", request);
    const rejection = expect(pending).rejects.toMatchObject({
      name: "WorkbenchTimeoutError", code: "WORKBENCH_REQUEST_TIMEOUT", status: 504,
      messageKey: "managementError.workbench.timeout",
    });
    deadline.abort(new DOMException("private upstream details", "TimeoutError"));
    await rejection;
    await expect(pending).rejects.not.toThrow(/private/u);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(12_345);
  });

  it("propagates caller cancellation to fetch and preserves its reason", async () => {
    const caller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const reason: unknown = init.signal?.reason;
        reject(reason instanceof Error ? reason : new Error("Unexpected non-error abort"));
      }, { once: true });
    }));
    const client = new WorkbenchClient({ baseUrl: "https://workbench", requestTimeoutMs: 30_000, fetch: fetchImpl });
    const pending = client.readBookstack("token", request, caller.signal);
    const reason = new DOMException("Tool call stopped", "AbortError");
    const rejection = expect(pending).rejects.toBe(reason);
    caller.abort(reason);
    await rejection;
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await expect(client.readBookstack("token", request, caller.signal)).rejects.toBe(reason);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not mislabel an upstream abort as the local timeout", async () => {
    const error = new DOMException("Connection aborted", "AbortError");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error);
    const client = new WorkbenchClient({ baseUrl: "https://workbench", requestTimeoutMs: 30_000, fetch: fetchImpl });
    await expect(client.readBookstack("token", request)).rejects.toBe(error);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

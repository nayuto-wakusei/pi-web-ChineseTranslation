import { describe, expect, it } from "vitest";
import { TrailingRefreshCoordinator } from "./trailingRefreshCoordinator";

describe("refresh requests at the completion boundary", () => {
  it.each([2, 3])("keeps a new request independent of a completed failure after %s microtasks", async (ticks) => {
    const coordinator = new TrailingRefreshCoordinator<string>();
    const error = new Error("initial refresh failed");
    const initial = coordinator.request("session", () => Promise.reject(error));
    void initial.catch(() => undefined);
    for (let tick = 0; tick < ticks; tick += 1) await Promise.resolve();
    let replacementRuns = 0;
    const replacement = coordinator.request("session", () => {
      replacementRuns += 1;
      return Promise.resolve();
    });
    expect(await Promise.allSettled([initial, replacement])).toEqual([
      { status: "rejected", reason: error },
      { status: "fulfilled", value: undefined },
    ]);
    expect(replacementRuns).toBe(1);
  });
  it.each([0, 1, 2, 3, 4, 5])("does not strand a request arriving after %s microtasks", async (ticks) => {
    const coordinator = new TrailingRefreshCoordinator<string>();
    let initialRuns = 0;
    let replacementRuns = 0;
    const initial = coordinator.request("session", () => {
      initialRuns += 1;
      return Promise.resolve();
    });
    for (let tick = 0; tick < ticks; tick += 1) await Promise.resolve();
    const replacement = coordinator.request("session", () => {
      replacementRuns += 1;
      return Promise.resolve();
    });
    await Promise.all([initial, replacement]);
    expect(initialRuns).toBe(ticks === 0 ? 0 : 1);
    expect(replacementRuns).toBe(1);
  });
});

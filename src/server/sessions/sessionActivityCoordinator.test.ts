import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionActivityCoordinator } from "./sessionActivityCoordinator.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionActivityCoordinator", () => {
  it("cancels delayed refreshes when cleared", async () => {
    vi.useFakeTimers();
    const coordinator = new SessionActivityCoordinator();
    const refresh = vi.fn();

    coordinator.scheduleSettledRefresh("session-1", refresh, 250);
    coordinator.clear();
    await vi.advanceTimersByTimeAsync(250);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("cancels a session's delayed refresh when its activity is deleted", async () => {
    vi.useFakeTimers();
    const coordinator = new SessionActivityCoordinator();
    const refresh = vi.fn();

    coordinator.scheduleSettledRefresh("session-1", refresh, 250);
    coordinator.delete("session-1");
    await vi.advanceTimersByTimeAsync(250);

    expect(refresh).not.toHaveBeenCalled();
  });
});

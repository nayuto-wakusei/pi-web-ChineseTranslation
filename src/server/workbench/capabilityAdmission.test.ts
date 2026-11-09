import { describe, expect, it, vi } from "vitest";
import { CapabilityAdmission } from "./capabilityAdmission.js";

describe("daemon capability admission", () => {
  it("limits a hot user's pending calls while other users can still enter and cancellation restores its quota", async () => {
    const gate = new CapabilityAdmission({ concurrent: 8, perPrincipal: 1, pending: 32, pendingPerPrincipal: 2, queueMs: 60_000 });
    const first = deferred();
    const started = deferred();
    const running = gate.run("hot", new AbortController().signal, async () => { started.resolve(); await first.promise; });
    await started.promise;
    const controller = new AbortController();
    const cancelled = gate.run("hot", controller.signal, () => Promise.resolve("cancelled queued work")).catch((error: unknown) => error);
    try {
      await expect(gate.run("hot", new AbortController().signal, () => Promise.resolve("not admitted"))).rejects.toThrow();
      expect(await gate.run("other", new AbortController().signal, () => Promise.resolve("other user proceeds"))).toBe("other user proceeds");
      controller.abort(new Error("cancelled"));
      expect(await cancelled).toMatchObject({ message: "cancelled" });
      const replacement = gate.run("hot", new AbortController().signal, () => Promise.resolve("quota restored"));
      first.resolve();
      await running;
      expect(await replacement).toBe("quota restored");
    } finally {
      controller.abort(new Error("cancelled"));
      first.resolve();
      await Promise.all([running, cancelled]);
    }
  });

  it("bounds total admission and lets another user use a free worker", async () => {
    const gate = new CapabilityAdmission({ concurrent: 2, perPrincipal: 1, pending: 3, queueMs: 60_000 });
    const controller = new AbortController();
    const first = deferred();
    const firstStarted = deferred();
    const running = gate.run("user-a", controller.signal, async () => { firstStarted.resolve(); await first.promise; });
    await firstStarted.promise;
    const waiting = gate.run("user-a", controller.signal, () => Promise.resolve("queued"));
    const other = deferred();
    const otherStarted = deferred();
    const otherRunning = gate.run("user-b", controller.signal, async () => { otherStarted.resolve(); await other.promise; });
    try {
      await otherStarted.promise;
      await expect(gate.run("user-c", controller.signal, () => Promise.resolve("not admitted"))).rejects.toThrow();
    } finally {
      other.resolve(); first.resolve();
      await Promise.all([running, otherRunning, waiting]);
    }
    expect(await gate.run("user-a", controller.signal, () => Promise.resolve("recovered"))).toBe("recovered");
  });

  it("removes cancelled queued calls without releasing running capacity", async () => {
    const gate = new CapabilityAdmission({ concurrent: 1, perPrincipal: 1, pending: 2, queueMs: 60_000 });
    const first = deferred();
    const started = deferred();
    const running = gate.run("a", new AbortController().signal, async () => { started.resolve(); await first.promise; });
    await started.promise;
    const controller = new AbortController();
    const action = vi.fn(() => Promise.resolve("must not run"));
    const waiting = gate.run("b", controller.signal, action);
    const cancelled = expect(waiting).rejects.toThrow("cancelled");
    controller.abort(new Error("cancelled"));
    await cancelled;
    expect(action).not.toHaveBeenCalled();
    first.resolve(); await running;
    expect(await gate.run("c", new AbortController().signal, () => Promise.resolve("ok"))).toBe("ok");
  });

  it("expires queued work and never invokes its action later", async () => {
    const gate = new CapabilityAdmission({ concurrent: 1, perPrincipal: 1, pending: 2, queueMs: 10 });
    const first = deferred();
    const started = deferred();
    const running = gate.run("a", new AbortController().signal, async () => { started.resolve(); await first.promise; });
    await started.promise;
    const action = vi.fn(() => Promise.resolve("must not run"));
    try { await expect(gate.run("b", new AbortController().signal, action)).rejects.toThrow(); }
    finally { first.resolve(); await running; }
    expect(action).not.toHaveBeenCalled();
  });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

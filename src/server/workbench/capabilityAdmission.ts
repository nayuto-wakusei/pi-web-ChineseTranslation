import { loadNodeTranslator } from "../../localization.js";

interface WaitingCall {
  principal: string;
  start(): void;
  cancel(reason: unknown): void;
}

/** One daemon-owned gate, shared by all Workbench tool sessions. */
export class CapabilityAdmission {
  private active = 0;
  private readonly principals = new Map<string, number>();
  private readonly queue: WaitingCall[] = [];

  constructor(private readonly limits: { concurrent: number; perPrincipal: number; pending: number; pendingPerPrincipal?: number; queueMs: number }) {}

  async run<T>(principal: string, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const release = await this.acquire(principal, signal);
    try {
      signal.throwIfAborted();
      return await action();
    } finally {
      release();
    }
  }

  private acquire(principal: string, signal: AbortSignal): Promise<() => void> {
    const principalPending = (this.principals.get(principal) ?? 0) + this.queue.filter(waiter => waiter.principal === principal).length;
    if (this.active + this.queue.length >= this.limits.pending || principalPending >= (this.limits.pendingPerPrincipal ?? 8)) {
      return Promise.reject(new Error(loadNodeTranslator("server")("workbench.capacityBusy", "MCP call capacity is exhausted. Try again later.")));
    }
    if (this.available(principal)) return Promise.resolve(this.reserve(principal));
    return new Promise((resolve, reject) => {
      const remove = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
      };
      const waiter: WaitingCall = {
        principal,
        start: () => { remove(); resolve(this.reserve(principal)); },
        cancel: (reason) => { remove(); reject(reason instanceof Error ? reason : new Error(String(reason))); },
      };
      const aborted = () => { waiter.cancel(signal.reason); };
      const timer = setTimeout(() => { waiter.cancel(new Error(loadNodeTranslator("server")("workbench.queueTimeout", "MCP call queue timed out. Try again later."))); }, this.limits.queueMs);
      signal.addEventListener("abort", aborted, { once: true });
      this.queue.push(waiter);
      if (signal.aborted) aborted();
    });
  }

  private available(principal: string): boolean {
    return this.active < this.limits.concurrent && (this.principals.get(principal) ?? 0) < this.limits.perPrincipal;
  }

  private reserve(principal: string): () => void {
    this.active += 1;
    this.principals.set(principal, (this.principals.get(principal) ?? 0) + 1);
    return () => {
      this.active -= 1;
      const count = (this.principals.get(principal) ?? 1) - 1;
      if (count === 0) this.principals.delete(principal);
      else this.principals.set(principal, count);
      // A saturated principal must not occupy another principal's worker slots.
      for (const waiter of [...this.queue]) {
        if (this.available(waiter.principal)) waiter.start();
      }
    };
  }
}

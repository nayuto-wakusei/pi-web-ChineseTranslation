export interface StoredSessionActivity {
  phase: "active" | "idle" | "error";
  label: string;
  detail?: string;
  at: string;
}

export class SessionActivityCoordinator {
  private readonly records = new Map<string, StoredSessionActivity>();
  private readonly settleTimers = new Map<string, NodeJS.Timeout>();

  get(key: string): StoredSessionActivity | undefined {
    return this.records.get(key);
  }

  set(key: string, activity: StoredSessionActivity): void {
    this.records.set(key, activity);
  }

  delete(key: string): void {
    this.records.delete(key);
    this.cancelSettledRefresh(key);
  }

  scheduleSettledRefresh(key: string, callback: () => void, delayMs: number): void {
    this.cancelSettledRefresh(key);
    const timer = setTimeout(() => {
      this.settleTimers.delete(key);
      callback();
    }, delayMs);
    timer.unref();
    this.settleTimers.set(key, timer);
  }

  clear(): void {
    this.records.clear();
    for (const timer of this.settleTimers.values()) clearTimeout(timer);
    this.settleTimers.clear();
  }

  private cancelSettledRefresh(key: string): void {
    const timer = this.settleTimers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    this.settleTimers.delete(key);
  }
}

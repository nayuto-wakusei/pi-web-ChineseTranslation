import type { GitStatusResponse } from "./browser/git-contract.js";

interface StatusEntry {
  value?: GitStatusResponse;
  expires: number;
  generation: number;
  pending: Map<AbortSignal, Promise<GitStatusResponse>>;
}

/** Completed snapshots are shared; cancellable scans belong to their exact invocation signal. */
export class GitStatusCache {
  private readonly entries = new Map<string, StatusEntry>();
  constructor(private readonly scan: (cwd: string, signal: AbortSignal) => Promise<GitStatusResponse>, private readonly now = Date.now) {}

  get(key: string, cwd: string, signal: AbortSignal, force = false): Promise<GitStatusResponse> {
    signal.throwIfAborted();
    const entry = this.entries.get(key) ?? { expires: 0, generation: 0, pending: new Map<AbortSignal, Promise<GitStatusResponse>>() };
    const pending = entry.pending.get(signal);
    if (pending !== undefined) return pending;
    if (!force && entry.value !== undefined && entry.expires > this.now()) return Promise.resolve(entry.value);
    this.entries.set(key, entry);
    if (force) delete entry.value;
    const generation = ++entry.generation;
    const request = Promise.resolve().then(() => this.scan(cwd, signal)).then((status) => {
      signal.throwIfAborted();
      if (entry.generation === generation) {
        if (status.isGitRepo) {
          entry.value = status;
          entry.expires = this.now() + 2000;
        } else delete entry.value;
      }
      return status;
    }).catch((error: unknown) => {
      if (entry.generation === generation) delete entry.value;
      throw error;
    }).finally(() => {
      entry.pending.delete(signal);
      for (const [oldKey, old] of this.entries) {
        if (old.pending.size === 0 && (old.value === undefined || old.expires <= this.now())) this.entries.delete(oldKey);
      }
    });
    entry.pending.set(signal, request);
    return request;
  }
}

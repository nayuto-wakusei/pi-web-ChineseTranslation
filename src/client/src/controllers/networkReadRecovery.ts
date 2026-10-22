import { NetworkRequestError } from "../api/http";

const RETRY_DELAYS_MS = [500, 1500, 3000];
const RETIRED = Symbol("retired-read");

/** Opt-in recovery for reads only; retirement also releases hung reads and timers. */
export async function readWithNetworkRecovery<T>(read: () => Promise<T>, isCurrent: () => boolean, signal?: AbortSignal, recoverNetwork = true): Promise<T | undefined> {
  const current = () => signal?.aborted !== true && isCurrent();
  let retries = 0;
  while (current()) {
    try {
      const result = await untilAborted(read(), signal);
      return result !== RETIRED && current() ? result : undefined;
    } catch (error) {
      if (signal?.aborted === true || (recoverNetwork && !isCurrent())) return undefined;
      const delay = RETRY_DELAYS_MS[retries];
      if (!recoverNetwork || !(error instanceof NetworkRequestError) || delay === undefined) throw error;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await untilAborted(new Promise<void>((resolve) => { timer = setTimeout(resolve, delay); }), signal);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      retries += 1;
    }
  }
  return undefined;
}

function untilAborted<T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof RETIRED> {
  if (signal === undefined) return pending;
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<typeof RETIRED>((resolve) => {
    onAbort = () => { resolve(RETIRED); };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  return Promise.race([pending, cancelled]).finally(() => { signal.removeEventListener("abort", onAbort); });
}

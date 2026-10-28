import { currentApiScope, removeManagementEntryToken, type ApiScope, withManagementEmbed } from "./managementEmbed";
import { resolveAppUrl } from "../appUrl";

/** A response-backed API failure, retaining the status needed at an ownership boundary. */
export class HttpRequestError extends Error {
  override name = "HttpRequestError";

  constructor(message: string, readonly status: number, options: ErrorOptions = {}) {
    super(message, options);
  }
}

/** Browser transport failure, not an HTTP, cancellation, or parsing failure. */
export class NetworkRequestError extends Error {
  override name = "NetworkRequestError";

  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
  }
}

let apiScope = currentApiScope();

export function setApiScope(scope: ApiScope): void {
  apiScope = scope;
}

export function scopedApiUrl(url: string): string {
  return resolveAppUrl(withManagementEmbed(url, undefined, apiScope));
}
export interface RequestOptions extends RequestInit {
  /** Opt-in transport deadline, including response body reads. No retries. */
  timeoutMs?: number;
}

export async function request<T>(url: string, parse: (value: unknown) => T, options?: RequestOptions): Promise<T> {
  const { timeoutMs, ...init } = options ?? {};
  const controller = timeoutMs === undefined ? undefined : new AbortController();
  const signal = controller?.signal ?? init.signal ?? undefined;
  const abort = () => controller?.abort(init.signal?.reason);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const scope = apiScope;
  const requestUrl = scopedApiUrl(url);
  let body: unknown;
  try {
    if (controller !== undefined && timeoutMs !== undefined) {
      if (init.signal?.aborted === true) abort();
      else init.signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => {
        controller.abort(new NetworkRequestError(`Request timed out after ${String(timeoutMs)}ms: ${url}`));
      }, timeoutMs);
    }
    signal?.throwIfAborted();
    const transport = (async () => {
      const response = await fetch(requestUrl, { ...init, headers, ...(signal === undefined ? {} : { signal }) });
      if (!response.ok) {
        const errorBody: unknown = await response.json().catch((): unknown => ({}));
        throw new HttpRequestError(errorMessage(errorBody) ?? response.statusText, response.status);
      }
      removeManagementEntryToken(scope);
      const body: unknown = await response.json();
      return body;
    })();
    // Racing also bounds transports that do not promptly settle after abort.
    body = signal === undefined ? await transport : await Promise.race([
      transport,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          // AbortSignal reasons may be arbitrary caller-provided values.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } catch (error) {
    if (signal?.aborted === true) throw signal.reason;
    if (error instanceof TypeError && error.name !== "AbortError") {
      throw new NetworkRequestError(error.message, { cause: error });
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
  }
  // Parser failures are not retryable transport failures.
  return parse(body);
}

export async function requestOptional<T>(url: string, parse: (value: unknown) => T, init?: RequestInit): Promise<T | undefined> {
  const scope = apiScope;
  const requestUrl = scopedApiUrl(url);
  const response = await transportRead(() => fetch(requestUrl, init), init?.signal);
  if (response.status === 204) {
    removeManagementEntryToken(scope);
    return undefined;
  }
  if (response.status === 404) return undefined;
  if (!response.ok) {
    const body: unknown = await response.json().catch((): unknown => ({}));
    throw new HttpRequestError(errorMessage(body) ?? response.statusText, response.status);
  }
  removeManagementEntryToken(scope);
  const body: unknown = await transportRead(() => response.json(), init?.signal);
  return parse(body);
}

async function transportRead<T>(read: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof TypeError && error.name !== "AbortError" && signal?.aborted !== true) {
      throw new NetworkRequestError(error.message, { cause: error });
    }
    throw error;
  }
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value["error"] === "string" ? value["error"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

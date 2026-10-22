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
export async function request<T>(url: string, parse: (value: unknown) => T, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const scope = apiScope;
  const requestUrl = scopedApiUrl(url);
  const response = await transportRead(() => fetch(requestUrl, { ...init, headers }), init?.signal);
  if (!response.ok) {
    const body: unknown = await response.json().catch((): unknown => ({}));
    throw new HttpRequestError(errorMessage(body) ?? response.statusText, response.status);
  }
  removeManagementEntryToken(scope);
  const body: unknown = await transportRead(() => response.json(), init?.signal);
  // Parser errors must never be mistaken for retryable transport failures.
  return parse(body);
}

export async function requestOptional<T>(url: string, parse: (value: unknown) => T): Promise<T | undefined> {
  const scope = apiScope;
  const requestUrl = scopedApiUrl(url);
  const response = await transportRead(() => fetch(requestUrl));
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
  const body: unknown = await transportRead(() => response.json());
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

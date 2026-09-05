import { currentApiScope, removeManagementEntryToken, type ApiScope, withManagementEmbed } from "./managementEmbed";
import { resolveAppUrl } from "../appUrl";

/** A response-backed API failure, retaining the status needed at an ownership boundary. */
export class HttpRequestError extends Error {
  override name = "HttpRequestError";

  constructor(message: string, readonly status: number, options: ErrorOptions = {}) {
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
  const response = await fetch(scopedApiUrl(url), { ...init, headers });
  if (!response.ok) {
    const body: unknown = await response.json().catch((): unknown => ({}));
    throw new HttpRequestError(errorMessage(body) ?? response.statusText, response.status);
  }
  removeManagementEntryToken(apiScope);
  const body: unknown = await response.json();
  return parse(body);
}

export async function requestOptional<T>(url: string, parse: (value: unknown) => T): Promise<T | undefined> {
  const response = await fetch(scopedApiUrl(url));
  if (response.status === 204) {
    removeManagementEntryToken(apiScope);
    return undefined;
  }
  if (response.status === 404) return undefined;
  if (!response.ok) {
    const body: unknown = await response.json().catch((): unknown => ({}));
    throw new Error(errorMessage(body) ?? response.statusText);
  }
  removeManagementEntryToken(apiScope);
  return parse(await response.json());
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value["error"] === "string" ? value["error"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

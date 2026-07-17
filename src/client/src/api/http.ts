import { currentApiScope, type ApiScope, withManagementEmbed } from "./managementEmbed";
import { resolveAppUrl } from "../appUrl";

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
    throw new Error(errorMessage(body) ?? response.statusText);
  }
  const body: unknown = await response.json();
  return parse(body);
}

export async function requestOptional<T>(url: string, parse: (value: unknown) => T): Promise<T | undefined> {
  const response = await fetch(scopedApiUrl(url));
  if (response.status === 204 || response.status === 404) return undefined;
  if (!response.ok) {
    const body: unknown = await response.json().catch((): unknown => ({}));
    throw new Error(errorMessage(body) ?? response.statusText);
  }
  return parse(await response.json());
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value["error"] === "string" ? value["error"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

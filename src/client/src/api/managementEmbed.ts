export type ApiScope = "normal" | "management";

const MANAGEMENT_EMBED_MODE = "management";

export function isManagementEmbedMode(search: string | undefined = browserSearch()): boolean {
  return readEmbedMode(search) === MANAGEMENT_EMBED_MODE;
}

export function currentApiScope(pageUrl: URL | undefined = currentPageUrl()): ApiScope {
  return isManagementEmbedMode(pageUrl?.search) ? "management" : "normal";
}

export function withManagementEmbed(url: string, pageUrl: URL | undefined = currentPageUrl(), scope: ApiScope = "management"): string {
  return scopedManagementUrl(url, pageUrl, scope, true);
}

export function withManagementEmbedQuery(url: string, pageUrl: URL | undefined = currentPageUrl(), scope: ApiScope = "management"): string {
  return scopedManagementUrl(url, pageUrl, scope, false);
}

export function removeManagementEntryToken(scope: ApiScope): void {
  if (scope !== "management" || typeof globalThis.history === "undefined") return;
  const pageUrl = currentPageUrl();
  if (pageUrl === undefined || managementEmbedParams(pageUrl)?.token === undefined) return;
  pageUrl.searchParams.delete("token");
  globalThis.history.replaceState(globalThis.history.state, "", `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`);
}

function scopedManagementUrl(url: string, pageUrl: URL | undefined, scope: ApiScope, includeHash: boolean): string {
  if (scope === "normal") return url;
  if (pageUrl === undefined) return url;
  const params = managementEmbedParams(pageUrl);
  if (params === undefined) return url;

  const requestUrl = new URL(url, pageUrl.origin);
  requestUrl.searchParams.set("embed", params.embed);
  if (params.token !== undefined) requestUrl.searchParams.set("token", params.token);

  return `${requestUrl.pathname}${requestUrl.search}${includeHash ? requestUrl.hash : ""}`;
}

function managementEmbedParams(pageUrl: URL | undefined): { embed: "management"; token?: string } | undefined {
  if (pageUrl === undefined) return undefined;
  const embed = readEmbedMode(pageUrl.search);
  const token = pageUrl.searchParams.get("token")?.trim();
  if (embed !== MANAGEMENT_EMBED_MODE) return undefined;
  return { embed, ...(token === undefined || token === "" ? {} : { token }) };
}

function readEmbedMode(search: string | undefined): string | undefined {
  if (search === undefined || search === "") return undefined;
  const mode = new URLSearchParams(search).get("embed")?.trim();
  return mode === "" ? undefined : mode;
}

function browserSearch(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.search;
}

function currentPageUrl(): URL | undefined {
  if (typeof globalThis.location === "undefined") return undefined;
  const location = globalThis.location;
  if (typeof location.href === "string" && location.href !== "") return new URL(location.href);
  const protocol = typeof location.protocol === "string" && location.protocol !== "" ? location.protocol : "http:";
  const host = typeof location.host === "string" && location.host !== "" ? location.host : "localhost";
  const search = typeof location.search === "string" ? location.search : "";
  return new URL(`${protocol}//${host}/${search}`);
}

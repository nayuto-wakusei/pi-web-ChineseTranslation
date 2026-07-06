export type ApiScope = "normal" | "management";

export function currentApiScope(pageUrl: URL | undefined = currentPageUrl()): ApiScope {
  return managementEmbedParams(pageUrl) === undefined ? "normal" : "management";
}

export function withManagementEmbed(url: string, pageUrl: URL | undefined = currentPageUrl(), scope: ApiScope = "management"): string {
  if (scope === "normal") return url;
  if (pageUrl === undefined) return url;
  const params = managementEmbedParams(pageUrl);
  if (params === undefined) return url;

  const requestUrl = new URL(url, pageUrl.origin);
  requestUrl.searchParams.set("embed", params.embed);
  requestUrl.searchParams.set("token", params.token);

  return `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`;
}

export function withManagementEmbedQuery(url: string, pageUrl: URL | undefined = currentPageUrl(), scope: ApiScope = "management"): string {
  if (scope === "normal") return url;
  if (pageUrl === undefined) return url;
  const params = managementEmbedParams(pageUrl);
  if (params === undefined) return url;

  const requestUrl = new URL(url, pageUrl.origin);
  requestUrl.searchParams.set("embed", params.embed);
  requestUrl.searchParams.set("token", params.token);

  return `${requestUrl.pathname}${requestUrl.search}`;
}

function managementEmbedParams(pageUrl: URL | undefined): { embed: "management"; token: string } | undefined {
  if (pageUrl === undefined) return undefined;
  const embed = pageUrl.searchParams.get("embed");
  const token = pageUrl.searchParams.get("token")?.trim();
  if (embed !== "management" || token === undefined || token === "") return undefined;
  return { embed, token };
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

export function withManagementEmbed(url: string, pageUrl: URL | undefined = currentPageUrl()): string {
  if (pageUrl === undefined) return url;
  const params = managementEmbedParams(pageUrl);
  if (params === undefined) return url;

  const requestUrl = new URL(url, pageUrl.origin);
  requestUrl.searchParams.set("embed", params.embed);
  requestUrl.searchParams.set("token", params.token);

  return `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`;
}

export function withManagementEmbedWebSocket(url: string, pageUrl: URL | undefined = currentPageUrl()): string {
  if (pageUrl === undefined) return url;
  const params = managementEmbedParams(pageUrl);
  if (params === undefined) return url;

  const requestUrl = new URL(url);
  requestUrl.searchParams.set("embed", params.embed);
  requestUrl.searchParams.set("token", params.token);

  return requestUrl.toString();
}

function managementEmbedParams(pageUrl: URL): { embed: "management"; token: string } | undefined {
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

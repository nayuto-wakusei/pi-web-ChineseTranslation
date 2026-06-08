const MANAGEMENT_EMBED_MODE = "management";

export function isManagementEmbedMode(search?: string): boolean {
  return readEmbedMode(search ?? browserSearch()) === MANAGEMENT_EMBED_MODE;
}

function readEmbedMode(search: string | undefined): string | undefined {
  if (search === undefined || search === "") return undefined;
  const mode = new URLSearchParams(search).get("embed")?.trim();
  return mode === "" ? undefined : mode;
}

function browserSearch(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.search;
}

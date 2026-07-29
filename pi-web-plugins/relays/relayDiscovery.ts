import type { FileContentResponse, FileTreeEntry, FileTreeResponse } from "@chainingintention/pi-web-cn/plugin-api";

export const RELAYS_ROOT = ".pi-web/relays";

/** Documents that anchor a relay packet, in display order. Any other files follow alphabetically. */
export const RELAY_ANCHOR_DOCUMENTS: readonly string[] = ["status.md", "charter.md", "log.md"];

/** Structural subset of the plugin WorkspaceFiles helper this module needs. */
export interface RelayDiscoveryFiles {
  listFiles(path: string): Promise<FileTreeResponse>;
  readFile(path: string): Promise<FileContentResponse>;
}

export interface RelaySummary {
  name: string;
  path: string;
  modifiedAt?: string | undefined;
}

export interface RelayDocumentEntry {
  name: string;
  path: string;
  modifiedAt?: string | undefined;
}

export type RelaysListing =
  | { kind: "loaded"; relays: RelaySummary[] }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: string };

export type RelayDocumentsListing =
  | { kind: "loaded"; documents: RelayDocumentEntry[] }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: string };

export type RelayDocumentContent =
  | { kind: "loaded"; content: string; truncated: boolean; binary: boolean }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: string };

// The workspace file API rejects with these messages when a path is absent or
// is not a directory. For the relays root both mean "zero relays", not a failure.
const missingListingErrorMessages = new Set(["Path does not exist", "Path is not a directory"]);

/** List the workspace's relays, most recently modified first. Never rejects. */
export async function listWorkspaceRelays(files: RelayDiscoveryFiles): Promise<RelaysListing> {
  let listing: FileTreeResponse;
  try {
    listing = await files.listFiles(RELAYS_ROOT);
  } catch (error) {
    return fileAccessFailure(error);
  }
  const relays = sortRelaysByRecency(
    listing.entries
      .filter((entry) => entry.type === "directory")
      .map((entry) => toRelaySummary(entry)),
  );
  return { kind: "loaded", relays };
}

/** List one relay's documents: status.md, charter.md, log.md first, then alphabetical. Never rejects. */
export async function listRelayDocuments(files: RelayDiscoveryFiles, relayPath: string): Promise<RelayDocumentsListing> {
  let listing: FileTreeResponse;
  try {
    listing = await files.listFiles(relayPath);
  } catch (error) {
    return fileAccessFailure(error);
  }
  const documents = orderRelayDocuments(
    listing.entries
      .filter((entry) => entry.type === "file")
      .map((entry) => toRelayDocumentEntry(entry)),
  );
  return { kind: "loaded", documents };
}

/** Read one relay document. Never rejects. */
export async function readRelayDocument(files: RelayDiscoveryFiles, documentPath: string): Promise<RelayDocumentContent> {
  try {
    const file = await files.readFile(documentPath);
    return { kind: "loaded", content: file.content, truncated: file.truncated, binary: file.binary };
  } catch (error) {
    return fileAccessFailure(error);
  }
}

/** Newest first; relays without a usable modifiedAt sort last, alphabetically. */
export function sortRelaysByRecency(relays: RelaySummary[]): RelaySummary[] {
  return [...relays].sort(compareRelaysByRecency);
}

/** Anchor documents first in fixed order, then everything else alphabetically. */
export function orderRelayDocuments(documents: RelayDocumentEntry[]): RelayDocumentEntry[] {
  return [...documents].sort(compareRelayDocuments);
}

/** The document a relay opens on: status.md when present, otherwise the first ordered document. */
export function defaultRelayDocument(documents: RelayDocumentEntry[]): RelayDocumentEntry | undefined {
  // Anchor ordering guarantees status.md is first whenever it exists.
  return orderRelayDocuments(documents)[0];
}

function toRelaySummary(entry: FileTreeEntry): RelaySummary {
  return { name: entry.name, path: entry.path, modifiedAt: entry.modifiedAt };
}

function toRelayDocumentEntry(entry: FileTreeEntry): RelayDocumentEntry {
  return { name: entry.name, path: entry.path, modifiedAt: entry.modifiedAt };
}

function compareRelaysByRecency(left: RelaySummary, right: RelaySummary): number {
  const leftTime = timestampOf(left.modifiedAt);
  const rightTime = timestampOf(right.modifiedAt);
  if (leftTime !== undefined && rightTime !== undefined && leftTime !== rightTime) return rightTime - leftTime;
  if (leftTime !== undefined) return -1;
  if (rightTime !== undefined) return 1;
  return left.name.localeCompare(right.name);
}

function timestampOf(modifiedAt: string | undefined): number | undefined {
  if (modifiedAt === undefined) return undefined;
  const time = Date.parse(modifiedAt);
  return Number.isNaN(time) ? undefined : time;
}

function compareRelayDocuments(left: RelayDocumentEntry, right: RelayDocumentEntry): number {
  const anchorOrder = anchorIndexOf(left.name) - anchorIndexOf(right.name);
  if (anchorOrder !== 0) return anchorOrder;
  return left.name.localeCompare(right.name);
}

function anchorIndexOf(name: string): number {
  const index = RELAY_ANCHOR_DOCUMENTS.indexOf(name);
  return index === -1 ? RELAY_ANCHOR_DOCUMENTS.length : index;
}

function fileAccessFailure(error: unknown): { kind: "missing" } | { kind: "unavailable"; detail: string } {
  if (error instanceof Error && missingListingErrorMessages.has(error.message)) return { kind: "missing" };
  return { kind: "unavailable", detail: error instanceof Error ? error.message : String(error) };
}

import type { FileContentResponse, FileTreeEntry, FileTreeResponse } from "@chainingintention/pi-web-cn/plugin-api";

export const RELAYS_ROOT = ".pi-web/relays";

/** Documents that anchor a relay packet, in display order. Any other files follow alphabetically. */
export const RELAY_ANCHOR_DOCUMENTS: readonly string[] = ["status.md", "charter.md", "operations.md", "log.md"];

/** Deepest node depth listed below the relay root; direct children are depth 0. */
export const MAX_RELAY_TREE_DEPTH = 5;

/** Most documents listed across one relay. */
export const MAX_RELAY_DOCUMENTS = 200;

/** Most directories walked across one relay. */
export const MAX_RELAY_DIRECTORIES = 50;

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

export interface RelayFileNode {
  kind: "file";
  name: string;
  path: string;
  relativePath: string;
  depth: number;
  modifiedAt?: string | undefined;
}

export interface RelayDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  relativePath: string;
  depth: number;
  children: RelayTreeNode[];
}

export type RelayTreeNode = RelayFileNode | RelayDirectoryNode;

export type RelaysListing =
  | { kind: "loaded"; relays: RelaySummary[] }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: string };

export type RelayDocumentsListing =
  | { kind: "loaded"; tree: RelayTreeNode[]; documentCount: number; partial: boolean }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: string };

export type RelayDocumentContent =
  | { kind: "loaded"; content: string; truncated: boolean; binary: boolean }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: string };

// The workspace file API rejects with these messages when a path is absent or
// is not a directory. For the relays root both mean "zero relays", not a failure.
const missingListingErrorMessages = new Set(["Path does not exist", "Path is not a directory"]);

interface WalkState {
  documentCount: number;
  directoryCount: number;
  partial: boolean;
}

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

/** List one relay's bounded document tree without following symlinks. Never rejects. */
export async function listRelayDocumentTree(files: RelayDiscoveryFiles, relayPath: string): Promise<RelayDocumentsListing> {
  let rootListing: FileTreeResponse;
  try {
    rootListing = await files.listFiles(relayPath);
  } catch (error) {
    return fileAccessFailure(error);
  }
  const state: WalkState = { documentCount: 0, directoryCount: 0, partial: rootListing.truncated };
  const tree = await walkListing(files, rootListing, relayPath, 0, state);
  return { kind: "loaded", tree, documentCount: state.documentCount, partial: state.partial };
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

/** The depth-first first file; root anchor ordering makes status.md win when present. */
export function defaultRelayDocument(tree: RelayTreeNode[]): RelayFileNode | undefined {
  for (const node of tree) {
    if (node.kind === "file") return node;
    const nested = defaultRelayDocument(node.children);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function flattenRelayTree(tree: RelayTreeNode[]): RelayFileNode[] {
  const files: RelayFileNode[] = [];
  const visit = (nodes: RelayTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "file") files.push(node);
      else visit(node.children);
    }
  };
  visit(tree);
  return files;
}

export function collectDirectoryPaths(tree: RelayTreeNode[]): Set<string> {
  const paths = new Set<string>();
  const visit = (nodes: RelayTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "directory") continue;
      paths.add(node.path);
      visit(node.children);
    }
  };
  visit(tree);
  return paths;
}

export function ancestorDirectoryPaths(tree: RelayTreeNode[], filePath: string): string[] {
  const chain: string[] = [];
  const visit = (nodes: RelayTreeNode[]): boolean => {
    for (const node of nodes) {
      if (node.kind === "file") {
        if (node.path === filePath) return true;
        continue;
      }
      chain.push(node.path);
      if (visit(node.children)) return true;
      chain.pop();
    }
    return false;
  };
  return visit(tree) ? chain : [];
}

async function walkListing(
  files: RelayDiscoveryFiles,
  listing: FileTreeResponse,
  relayPath: string,
  depth: number,
  state: WalkState,
): Promise<RelayTreeNode[]> {
  const fileEntries = listing.entries.filter((entry) => entry.type === "file");
  const directoryEntries = listing.entries.filter((entry) => entry.type === "directory");

  let fileNodes = orderFileEntries(fileEntries, depth === 0).map((entry) => toFileNode(entry, relayPath, depth));
  const remaining = MAX_RELAY_DOCUMENTS - state.documentCount;
  if (fileNodes.length > remaining) {
    fileNodes = fileNodes.slice(0, Math.max(0, remaining));
    state.partial = true;
  }
  state.documentCount += fileNodes.length;

  const directories = await Promise.all(
    [...directoryEntries].sort(compareByName).map(async (entry) => {
      const node: RelayDirectoryNode = {
        kind: "directory",
        name: entry.name,
        path: entry.path,
        relativePath: relativePathOf(entry.path, relayPath),
        depth,
        children: [],
      };
      if (depth >= MAX_RELAY_TREE_DEPTH || state.directoryCount >= MAX_RELAY_DIRECTORIES) {
        state.partial = true;
        return node;
      }
      state.directoryCount += 1;
      try {
        const subListing = await files.listFiles(entry.path);
        if (subListing.truncated) state.partial = true;
        node.children = await walkListing(files, subListing, relayPath, depth + 1, state);
      } catch {
        state.partial = true;
      }
      return node;
    }),
  );

  return [...fileNodes, ...directories];
}

function orderFileEntries(entries: FileTreeEntry[], isRelayRoot: boolean): FileTreeEntry[] {
  return [...entries].sort(isRelayRoot ? compareRootFiles : compareByName);
}

function compareRootFiles(left: FileTreeEntry, right: FileTreeEntry): number {
  const anchorOrder = anchorIndexOf(left.name) - anchorIndexOf(right.name);
  if (anchorOrder !== 0) return anchorOrder;
  return left.name.localeCompare(right.name);
}

function compareByName(left: FileTreeEntry, right: FileTreeEntry): number {
  return left.name.localeCompare(right.name);
}

function toRelaySummary(entry: FileTreeEntry): RelaySummary {
  return { name: entry.name, path: entry.path, modifiedAt: entry.modifiedAt };
}

function toFileNode(entry: FileTreeEntry, relayPath: string, depth: number): RelayFileNode {
  return {
    kind: "file",
    name: entry.name,
    path: entry.path,
    relativePath: relativePathOf(entry.path, relayPath),
    depth,
    modifiedAt: entry.modifiedAt,
  };
}

function relativePathOf(path: string, relayPath: string): string {
  const prefix = `${relayPath}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path.slice(path.lastIndexOf("/") + 1);
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

function anchorIndexOf(name: string): number {
  const index = RELAY_ANCHOR_DOCUMENTS.indexOf(name);
  return index === -1 ? RELAY_ANCHOR_DOCUMENTS.length : index;
}

function fileAccessFailure(error: unknown): { kind: "missing" } | { kind: "unavailable"; detail: string } {
  if (error instanceof Error && missingListingErrorMessages.has(error.message)) return { kind: "missing" };
  return { kind: "unavailable", detail: error instanceof Error ? error.message : String(error) };
}

import { describe, expect, it, vi } from "vitest";
import type { FileContentResponse, FileTreeEntry, FileTreeResponse } from "@chainingintention/pi-web-cn/plugin-api";
import {
  ancestorDirectoryPaths,
  collectDirectoryPaths,
  defaultRelayDocument,
  flattenRelayTree,
  listRelayDocumentTree,
  listWorkspaceRelays,
  MAX_RELAY_TREE_DEPTH,
  readRelayDocument,
  RELAYS_ROOT,
  sortRelaysByRecency,
  type RelayDiscoveryFiles,
  type RelaySummary,
  type RelayTreeNode,
} from "./relayDiscovery";

describe("listWorkspaceRelays", () => {
  it("lists relay directories through the workspace files helper, most recently modified first", async () => {
    const listFiles = vi.fn<RelayDiscoveryFiles["listFiles"]>(() => Promise.resolve(tree([
      directoryEntry("older", "2026-01-01T00:00:00.000Z"),
      fileEntry("stray-file.md", "2026-03-01T00:00:00.000Z"),
      directoryEntry("newer", "2026-02-01T00:00:00.000Z"),
      symlinkEntry("linked", "2026-04-01T00:00:00.000Z"),
    ])));
    const files = filesWith({ listFiles });

    const result = await listWorkspaceRelays(files);

    expect(listFiles).toHaveBeenCalledWith(RELAYS_ROOT);
    expect(result).toEqual({
      kind: "loaded",
      relays: [
        { name: "newer", path: `${RELAYS_ROOT}/newer`, modifiedAt: "2026-02-01T00:00:00.000Z" },
        { name: "older", path: `${RELAYS_ROOT}/older`, modifiedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
  });

  it("reports an empty relays directory as zero relays", async () => {
    const files = filesWith({ listFiles: () => Promise.resolve(tree([])) });

    await expect(listWorkspaceRelays(files)).resolves.toEqual({ kind: "loaded", relays: [] });
  });

  it("treats a missing relays directory as missing rather than a failure", async () => {
    const files = filesWith({ listFiles: () => Promise.reject(new Error("Path does not exist")) });

    await expect(listWorkspaceRelays(files)).resolves.toEqual({ kind: "missing" });
  });

  it("treats a relays root that is not a directory as missing rather than a failure", async () => {
    const files = filesWith({ listFiles: () => Promise.reject(new Error("Path is not a directory")) });

    await expect(listWorkspaceRelays(files)).resolves.toEqual({ kind: "missing" });
  });

  it("surfaces other listing failures as unavailable with the error detail", async () => {
    const files = filesWith({ listFiles: () => Promise.reject(new Error("connection lost")) });

    await expect(listWorkspaceRelays(files)).resolves.toEqual({ kind: "unavailable", detail: "connection lost" });
  });
});

describe("sortRelaysByRecency", () => {
  it("sorts undated and invalid-dated relays after dated ones, alphabetically", () => {
    const relays: RelaySummary[] = [
      { name: "zulu", path: "zulu" },
      { name: "middle", path: "middle", modifiedAt: "2026-02-01T00:00:00.000Z" },
      { name: "alpha", path: "alpha" },
      { name: "broken", path: "broken", modifiedAt: "not-a-date" },
      { name: "newest", path: "newest", modifiedAt: "2026-03-01T00:00:00.000Z" },
    ];

    expect(sortRelaysByRecency(relays).map((relay) => relay.name)).toEqual(["newest", "middle", "alpha", "broken", "zulu"]);
  });

  it("does not mutate the input array", () => {
    const relays: RelaySummary[] = [
      { name: "b", path: "b", modifiedAt: "2026-01-01T00:00:00.000Z" },
      { name: "a", path: "a", modifiedAt: "2026-02-01T00:00:00.000Z" },
    ];

    sortRelaysByRecency(relays);

    expect(relays.map((relay) => relay.name)).toEqual(["b", "a"]);
  });
});

describe("listRelayDocumentTree", () => {
  it("orders root anchors before files and recursively lists sorted directories", async () => {
    const relayPath = `${RELAYS_ROOT}/my-relay`;
    const relayFile = (name: string): FileTreeEntry => ({ name, path: `${relayPath}/${name}`, type: "file" });
    const listFiles = vi.fn<RelayDiscoveryFiles["listFiles"]>((path) => Promise.resolve(path === relayPath
      ? treeFor(path, [relayFile("notes.md"), relayFile("log.md"), relayFile("operations.md"), directoryAt(relayPath, "subdir"), relayFile("status.md")])
      : treeFor(path, [fileAt(path, "zeta.md"), fileAt(path, "alpha.md")])));
    const files = filesWith({ listFiles });

    const result = await listRelayDocumentTree(files, relayPath);

    expect(listFiles).toHaveBeenCalledWith(`${relayPath}/subdir`);
    expect(result.kind).toBe("loaded");
    if (result.kind !== "loaded") throw new Error("relay tree did not load");
    expect(flattenRelayTree(result.tree).map((file) => file.relativePath)).toEqual([
      "status.md", "operations.md", "log.md", "notes.md", "subdir/alpha.md", "subdir/zeta.md",
    ]);
    expect(result).toMatchObject({ documentCount: 6, partial: false });
  });

  it("does not follow symlinks and marks unreadable subdirectories partial", async () => {
    const relayPath = `${RELAYS_ROOT}/relay`;
    const listFiles = vi.fn<RelayDiscoveryFiles["listFiles"]>((path) => {
      if (path === relayPath) return Promise.resolve(treeFor(path, [symlinkAt(path, "linked"), directoryAt(path, "locked")]));
      return Promise.reject(new Error("permission denied"));
    });

    const result = await listRelayDocumentTree(filesWith({ listFiles }), relayPath);

    expect(listFiles).not.toHaveBeenCalledWith(`${relayPath}/linked`);
    expect(result).toMatchObject({ kind: "loaded", documentCount: 0, partial: true });
  });

  it("bounds deep directory trees and reports a partial result", async () => {
    const relayPath = `${RELAYS_ROOT}/relay`;
    const listFiles = vi.fn<RelayDiscoveryFiles["listFiles"]>((path) => {
      const depth = path === relayPath ? 0 : path.split("/").length - relayPath.split("/").length;
      return Promise.resolve(treeFor(path, [fileAt(path, `level-${String(depth)}.md`), directoryAt(path, "next")]));
    });

    const result = await listRelayDocumentTree(filesWith({ listFiles }), relayPath);

    expect(result.kind).toBe("loaded");
    if (result.kind !== "loaded") throw new Error("relay tree did not load");
    expect(result.partial).toBe(true);
    expect(flattenRelayTree(result.tree)).toHaveLength(MAX_RELAY_TREE_DEPTH + 1);
  });

  it("preserves missing and unavailable root failures", async () => {
    await expect(listRelayDocumentTree(filesWith({ listFiles: () => Promise.reject(new Error("Path does not exist")) }), "gone"))
      .resolves.toEqual({ kind: "missing" });
    await expect(listRelayDocumentTree(filesWith({ listFiles: () => Promise.reject(new Error("boom")) }), "broken"))
      .resolves.toEqual({ kind: "unavailable", detail: "boom" });
  });
});

describe("relay tree helpers", () => {
  const tree: RelayTreeNode[] = [{
    kind: "directory", name: "notes", path: "relay/notes", relativePath: "notes", depth: 0,
    children: [{ kind: "file", name: "topic.md", path: "relay/notes/topic.md", relativePath: "notes/topic.md", depth: 1 }],
  }];

  it("finds the default document, directories, and selected-file ancestors", () => {
    expect(defaultRelayDocument(tree)?.path).toBe("relay/notes/topic.md");
    expect([...collectDirectoryPaths(tree)]).toEqual(["relay/notes"]);
    expect(ancestorDirectoryPaths(tree, "relay/notes/topic.md")).toEqual(["relay/notes"]);
    expect(ancestorDirectoryPaths(tree, "relay/missing.md")).toEqual([]);
  });
});

describe("readRelayDocument", () => {
  it("returns document content with its truncation and binary flags", async () => {
    const files = filesWith({
      readFile: () => Promise.resolve(fileContent({ content: "# Status", truncated: true, binary: false })),
    });

    await expect(readRelayDocument(files, `${RELAYS_ROOT}/r/log.md`)).resolves.toEqual({
      kind: "loaded",
      content: "# Status",
      truncated: true,
      binary: false,
    });
  });

  it("treats a vanished document as missing", async () => {
    const files = filesWith({ readFile: () => Promise.reject(new Error("Path does not exist")) });

    await expect(readRelayDocument(files, `${RELAYS_ROOT}/r/gone.md`)).resolves.toEqual({ kind: "missing" });
  });

  it("surfaces other read failures as unavailable", async () => {
    const files = filesWith({ readFile: () => Promise.reject(new Error("boom")) });

    await expect(readRelayDocument(files, `${RELAYS_ROOT}/r/x.md`)).resolves.toEqual({ kind: "unavailable", detail: "boom" });
  });
});

function filesWith(overrides: Partial<RelayDiscoveryFiles>): RelayDiscoveryFiles {
  return {
    listFiles: () => Promise.reject(new Error("listFiles not expected")),
    readFile: () => Promise.reject(new Error("readFile not expected")),
    ...overrides,
  };
}

function tree(entries: FileTreeEntry[]): FileTreeResponse {
  return { path: RELAYS_ROOT, entries, scannedAt: "2026-01-01T00:00:00.000Z", truncated: false };
}

function treeFor(path: string, entries: FileTreeEntry[]): FileTreeResponse {
  return { path, entries, scannedAt: "2026-01-01T00:00:00.000Z", truncated: false };
}

function directoryAt(path: string, name: string): FileTreeEntry {
  return { name, path: `${path}/${name}`, type: "directory" };
}

function fileAt(path: string, name: string): FileTreeEntry {
  return { name, path: `${path}/${name}`, type: "file" };
}

function symlinkAt(path: string, name: string): FileTreeEntry {
  return { name, path: `${path}/${name}`, type: "symlink" };
}

function directoryEntry(name: string, modifiedAt?: string): FileTreeEntry {
  return { name, path: `${RELAYS_ROOT}/${name}`, type: "directory", ...(modifiedAt === undefined ? {} : { modifiedAt }) };
}

function fileEntry(name: string, modifiedAt?: string): FileTreeEntry {
  return { name, path: `${RELAYS_ROOT}/${name}`, type: "file", ...(modifiedAt === undefined ? {} : { modifiedAt }) };
}

function symlinkEntry(name: string, modifiedAt?: string): FileTreeEntry {
  return { name, path: `${RELAYS_ROOT}/${name}`, type: "symlink", ...(modifiedAt === undefined ? {} : { modifiedAt }) };
}

function fileContent(overrides: Partial<FileContentResponse>): FileContentResponse {
  return {
    path: `${RELAYS_ROOT}/r/log.md`,
    encoding: "utf8",
    size: 8,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    content: "",
    truncated: false,
    binary: false,
    ...overrides,
  };
}

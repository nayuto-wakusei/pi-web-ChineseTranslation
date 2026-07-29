import { describe, expect, it, vi } from "vitest";
import type { FileContentResponse, FileTreeEntry, FileTreeResponse } from "@chainingintention/pi-web-cn/plugin-api";
import {
  defaultRelayDocument,
  listRelayDocuments,
  listWorkspaceRelays,
  orderRelayDocuments,
  readRelayDocument,
  RELAYS_ROOT,
  sortRelaysByRecency,
  type RelayDiscoveryFiles,
  type RelayDocumentEntry,
  type RelaySummary,
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

describe("listRelayDocuments", () => {
  it("lists relay files with anchor documents first, then alphabetical", async () => {
    const relayPath = `${RELAYS_ROOT}/my-relay`;
    const relayFile = (name: string): FileTreeEntry => ({ name, path: `${relayPath}/${name}`, type: "file" });
    const listFiles = vi.fn<RelayDiscoveryFiles["listFiles"]>(() => Promise.resolve(tree([
      relayFile("notes.md"),
      relayFile("log.md"),
      directoryEntry("subdir"),
      relayFile("status.md"),
      relayFile("charter.md"),
      relayFile("data.json"),
    ])));
    const files = filesWith({ listFiles });

    const result = await listRelayDocuments(files, relayPath);

    expect(listFiles).toHaveBeenCalledWith(relayPath);
    expect(result).toEqual({
      kind: "loaded",
      documents: [
        { name: "status.md", path: `${relayPath}/status.md`, modifiedAt: undefined },
        { name: "charter.md", path: `${relayPath}/charter.md`, modifiedAt: undefined },
        { name: "log.md", path: `${relayPath}/log.md`, modifiedAt: undefined },
        { name: "data.json", path: `${relayPath}/data.json`, modifiedAt: undefined },
        { name: "notes.md", path: `${relayPath}/notes.md`, modifiedAt: undefined },
      ],
    });
  });

  it("treats a vanished relay directory as missing", async () => {
    const files = filesWith({ listFiles: () => Promise.reject(new Error("Path does not exist")) });

    await expect(listRelayDocuments(files, `${RELAYS_ROOT}/gone`)).resolves.toEqual({ kind: "missing" });
  });

  it("surfaces other listing failures as unavailable", async () => {
    const files = filesWith({ listFiles: () => Promise.reject(new Error("boom")) });

    await expect(listRelayDocuments(files, `${RELAYS_ROOT}/x`)).resolves.toEqual({ kind: "unavailable", detail: "boom" });
  });
});

describe("orderRelayDocuments", () => {
  it("puts anchor documents first in fixed order without mutating the input", () => {
    const documents: RelayDocumentEntry[] = [
      { name: "zebra.md", path: "zebra.md" },
      { name: "log.md", path: "log.md" },
      { name: "status.md", path: "status.md" },
    ];

    const ordered = orderRelayDocuments(documents);

    expect(ordered.map((document) => document.name)).toEqual(["status.md", "log.md", "zebra.md"]);
    expect(documents.map((document) => document.name)).toEqual(["zebra.md", "log.md", "status.md"]);
  });
});

describe("defaultRelayDocument", () => {
  it("picks status.md when present", () => {
    const documents: RelayDocumentEntry[] = [
      { name: "charter.md", path: "charter.md" },
      { name: "status.md", path: "status.md" },
    ];

    expect(defaultRelayDocument(documents)?.name).toBe("status.md");
  });

  it("falls back to the first ordered document when status.md is absent", () => {
    const documents: RelayDocumentEntry[] = [
      { name: "alpha.md", path: "alpha.md" },
      { name: "charter.md", path: "charter.md" },
    ];

    expect(defaultRelayDocument(documents)?.name).toBe("charter.md");
  });

  it("returns undefined for a relay without documents", () => {
    expect(defaultRelayDocument([])).toBeUndefined();
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

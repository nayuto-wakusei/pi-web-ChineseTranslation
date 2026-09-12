import { lstat, opendir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { isAbsolute, join, win32 } from "node:path";
import { FILE_TREE_BATCH_MAX_PATHS, type WorkspaceTreeBatchResponse, type FileTreeEntry, type FileTreeResponse, type PiWebPathAccessConfig } from "../../shared/apiTypes.js";
import { resolveWorkspacePathAccessTarget } from "./pathAccessPolicy.js";

export const FILE_TREE_MAX_ENTRIES = 1000;
export const FILE_TREE_LSTAT_CONCURRENCY = 32;
export const FILE_TREE_BATCH_CONCURRENCY = 6;
export { FILE_TREE_BATCH_MAX_PATHS };

export async function listWorkspaceTree(rootPath: string, path: string | undefined, pathAccess?: PiWebPathAccessConfig, readStat = limitedLstat()): Promise<FileTreeResponse> {
  const { target, displayPath } = await resolveWorkspacePathAccessTarget(rootPath, path, pathAccess);
  const stat = await readStat(target);
  if (!stat.isDirectory()) throw new Error("Path is not a directory");

  const { selected, total } = await scanTopEntries(target);
  const entries = await mapWithConcurrency(selected, FILE_TREE_LSTAT_CONCURRENCY, async (entry): Promise<FileTreeEntry> => {
    const absolute = join(target, entry.name);
    const childPath = appendRequestPath(displayPath, entry.name);
    const childStat = await readStat(absolute);
    const type: FileTreeEntry["type"] = entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file";
    return { name: entry.name, path: childPath, type, size: childStat.size, modifiedAt: childStat.mtime.toISOString() };
  });

  return { path: displayPath, entries, scannedAt: new Date().toISOString(), truncated: total > selected.length };
}

export async function listWorkspaceTreeBatch(rootPath: string, paths: readonly string[], pathAccess?: PiWebPathAccessConfig): Promise<WorkspaceTreeBatchResponse> {
  paths = [...new Set(paths)];
  if (paths.length > FILE_TREE_BATCH_MAX_PATHS) throw new Error(`At most ${String(FILE_TREE_BATCH_MAX_PATHS)} paths may be requested at once`);
  const readStat = limitedLstat();
  const results = await mapWithConcurrency(paths, FILE_TREE_BATCH_CONCURRENCY, async (path) => {
    try {
      return { path, tree: await listWorkspaceTree(rootPath, path, pathAccess, readStat) };
    } catch (error) {
      return { path, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return { results };
}

async function scanTopEntries(target: string): Promise<{ selected: Dirent[]; total: number }> {
  const selected: Dirent[] = [];
  let total = 0;
  const directory = await opendir(target);
  for await (const entry of directory) {
    total += 1;
    retainTopEntry(selected, entry);
  }
  selected.sort(compareEntryNames);
  return { selected, total };
}

function limitedLstat() {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (path: string) => {
    if (active === FILE_TREE_LSTAT_CONCURRENCY) await new Promise<void>((resolve) => { waiting.push(resolve); });
    else active += 1;
    try { return await lstat(path); }
    finally {
      const next = waiting.shift();
      if (next === undefined) active -= 1;
      else next();
    }
  };
}

function retainTopEntry(entries: Dirent[], entry: Dirent): void {
  if (entries.length < FILE_TREE_MAX_ENTRIES) {
    entries.push(entry);
    if (entries.length === FILE_TREE_MAX_ENTRIES) entries.sort(compareEntryNames);
    return;
  }
  const last = entries.at(-1);
  if (last === undefined || compareEntryNames(entry, last) >= 0) return;
  const index = lowerBound(entries, entry);
  entries.splice(index, 0, entry);
  entries.pop();
}

function lowerBound(entries: readonly Dirent[], entry: Dirent): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const current = entries[middle];
    if (current !== undefined && compareEntryNames(current, entry) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function compareEntryNames(a: Dirent, b: Dirent): number {
  return Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name);
}

async function mapWithConcurrency<T, R>(values: readonly T[], concurrency: number, mapper: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function appendRequestPath(base: string, name: string): string {
  if (base === "") return name;
  if (isAbsolute(base) || win32.isAbsolute(base)) return join(base, name);
  if (base.endsWith("/") || base.endsWith("\\")) return `${base}${name}`;
  return `${base}/${name}`;
}

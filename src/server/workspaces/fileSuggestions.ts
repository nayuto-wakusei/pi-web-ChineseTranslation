import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import type { ClientFileSuggestion } from "../types.js";

const execFileAsync = promisify(execFile);
const commandMaxBuffer = 1024 * 1024 * 8;
const maxFilesystemFallbackPaths = 20_000;
const maxFileSuggestions = 80;

interface ExecFileOptions {
  cwd: string;
  maxBuffer: number;
  env?: NodeJS.ProcessEnv;
}

export type FileSuggestionScope = "tracked" | "all";

export interface FileSuggestionOptions {
  kind?: ClientFileSuggestion["kind"] | undefined;
  scope?: FileSuggestionScope | undefined;
}

export interface FileSuggestionDependencies {
  execFile?: (file: string, args: string[], options: ExecFileOptions) => Promise<{ stdout: string }>;
}

export async function listFileSuggestions(cwd: string, query = "", options: FileSuggestionOptions = {}, deps: FileSuggestionDependencies = {}): Promise<ClientFileSuggestion[]> {
  const normalizedQuery = normalizeFileQuery(query);
  const exec = deps.execFile ?? execFileAsync;
  const files = await listFilesForScope(cwd, options.scope, exec);
  return rankFileSuggestions(
    files.filter((file) => options.kind === undefined || file.kind === options.kind),
    normalizedQuery,
  ).slice(0, maxFileSuggestions);
}

export async function listPathSuggestions(cwd: string, prefix = ""): Promise<ClientFileSuggestion[]> {
  const normalizedPrefix = prefix.replace(/^@/, "").replace(/\\/g, "/");
  const directoryPrefix = normalizedPrefix.endsWith("/") ? normalizedPrefix : dirname(normalizedPrefix) === "." ? "" : `${dirname(normalizedPrefix)}/`;
  const searchPrefix = normalizedPrefix.endsWith("/") ? "" : basename(normalizedPrefix);
  const entries = await readdir(join(cwd, directoryPrefix), { withFileTypes: true });
  const suggestions: ClientFileSuggestion[] = [];
  for (const entry of entries) {
    if (!entry.name.toLowerCase().startsWith(searchPrefix.toLowerCase())) continue;
    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) {
      try {
        isDirectory = (await stat(join(cwd, directoryPrefix, entry.name))).isDirectory();
      } catch {
        isDirectory = false;
      }
    }
    suggestions.push({ path: `${directoryPrefix}${entry.name}${isDirectory ? "/" : ""}`, kind: "other" });
  }
  return suggestions
    .sort((a, b) => Number(!a.path.endsWith("/")) - Number(!b.path.endsWith("/")) || a.path.localeCompare(b.path))
    .slice(0, 80);
}

async function listFilesForScope(cwd: string, scope: FileSuggestionScope | undefined, exec: NonNullable<FileSuggestionDependencies["execFile"]>): Promise<ClientFileSuggestion[]> {
  if (scope === "all") return listAllFiles(cwd, exec);
  if (scope === "tracked") return listTrackedFiles(cwd, exec).catch(() => listPlainFiles(cwd, exec, true));
  return listGitFiles(cwd, exec).catch(() => listPlainFiles(cwd, exec, false));
}

async function listTrackedFiles(cwd: string, exec: NonNullable<FileSuggestionDependencies["execFile"]>): Promise<ClientFileSuggestion[]> {
  return withDirectories(nulRecords(await git(cwd, ["ls-files", "-z"], exec)), "tracked");
}

async function listGitFiles(cwd: string, exec: NonNullable<FileSuggestionDependencies["execFile"]>): Promise<ClientFileSuggestion[]> {
  const [tracked, untracked] = await Promise.all([
    git(cwd, ["ls-files", "-z"], exec),
    git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], exec),
  ]);
  return [
    ...withDirectories(nulRecords(tracked), "tracked"),
    ...withDirectories(nulRecords(untracked), "untracked"),
  ];
}

async function listAllFiles(cwd: string, exec: NonNullable<FileSuggestionDependencies["execFile"]>): Promise<ClientFileSuggestion[]> {
  const [gitFiles, plainFiles] = await Promise.all([
    listGitFiles(cwd, exec).catch((): ClientFileSuggestion[] => []),
    listPlainFiles(cwd, exec, true),
  ]);
  return mergeSuggestions(gitFiles, plainFiles);
}

async function listPlainFiles(cwd: string, exec: NonNullable<FileSuggestionDependencies["execFile"]>, includeIgnored: boolean): Promise<ClientFileSuggestion[]> {
  try {
    const args = includeIgnored ? ["--files", "--hidden", "--no-ignore", "--glob", "!.git", "--glob", "!.git/**"] : ["--files"];
    const { stdout } = await exec("rg", args, { cwd, maxBuffer: commandMaxBuffer });
    return withDirectories(textLines(stdout), "other");
  } catch {
    return withDirectories(await filesystemFiles(cwd), "other");
  }
}

async function filesystemFiles(cwd: string): Promise<string[]> {
  const paths: string[] = [];
  await collectFilesystemFiles(cwd, "", paths, false);
  return paths;
}

async function collectFilesystemFiles(cwd: string, relativeDirectory: string, paths: string[], optionalDirectory: boolean): Promise<void> {
  if (paths.length >= maxFilesystemFallbackPaths) return;
  const absoluteDirectory = relativeDirectory === "" ? cwd : join(cwd, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (optionalDirectory) return;
    throw error;
  }

  entries.sort((a, b) => Number(!a.isDirectory()) - Number(!b.isDirectory()) || a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (paths.length >= maxFilesystemFallbackPaths) return;
    const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      await collectFilesystemFiles(cwd, relativePath, paths, true);
      continue;
    }
    if (entry.isFile() || await isSymlinkedFile(cwd, relativePath, entry.isSymbolicLink())) paths.push(relativePath);
  }
}

async function isSymlinkedFile(cwd: string, relativePath: string, symbolicLink: boolean): Promise<boolean> {
  if (!symbolicLink) return false;
  try {
    return (await stat(join(cwd, relativePath))).isFile();
  } catch {
    return false;
  }
}

async function git(cwd: string, args: string[], exec: NonNullable<FileSuggestionDependencies["execFile"]>): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, env: sanitizedGitEnv(), maxBuffer: commandMaxBuffer });
  return stdout;
}

function normalizeFileQuery(query: string): string {
  return query.replace(/^!@/, "").replace(/^@\s?/, "").replace(/^"/, "").toLowerCase();
}

function rankFileSuggestions(files: ClientFileSuggestion[], normalizedQuery: string): ClientFileSuggestion[] {
  if (normalizedQuery === "") return [...files].sort(compareFileSuggestions);
  return files
    .map((file) => ({ file, score: fileSuggestionScore(file.path, normalizedQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || kindRank(a.file.kind) - kindRank(b.file.kind) || pathDepth(a.file.path) - pathDepth(b.file.path) || compareFileSuggestions(a.file, b.file))
    .map(({ file }) => file);
}

function fileSuggestionScore(path: string, normalizedQuery: string): number {
  const normalizedPath = normalizeSuggestionPathForSearch(path);
  const name = displayBasename(normalizedPath);
  if (normalizedPath === normalizedQuery) return 1000;
  if (name === normalizedQuery) return 980;
  if (name.startsWith(normalizedQuery)) return 900;
  if (normalizedPath.startsWith(normalizedQuery)) return 850;
  if (name.includes(normalizedQuery)) return 750;
  if (normalizedPath.includes(normalizedQuery)) return 650;

  const tokens = normalizedQuery.split(/\s+/u).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => normalizedPath.includes(token))) {
    return 550 + tokens.filter((token) => name.includes(token)).length * 25;
  }

  return isSubsequence(normalizedQuery, normalizedPath) ? 200 : 0;
}

function normalizeSuggestionPathForSearch(path: string): string {
  const lower = path.toLowerCase();
  return lower.endsWith("/") ? lower.slice(0, -1) : lower;
}

function displayBasename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let haystackIndex = 0;
  for (const char of needle) {
    haystackIndex = haystack.indexOf(char, haystackIndex);
    if (haystackIndex === -1) return false;
    haystackIndex += char.length;
  }
  return true;
}

function compareFileSuggestions(a: ClientFileSuggestion, b: ClientFileSuggestion): number {
  return Number(!a.path.endsWith("/")) - Number(!b.path.endsWith("/")) || a.path.localeCompare(b.path);
}

function kindRank(kind: ClientFileSuggestion["kind"]): number {
  switch (kind) {
    case "tracked": return 0;
    case "untracked": return 1;
    case "other": return 2;
  }
}

function pathDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

function textLines(text: string): string[] {
  return text.split("\n").map((line) => line.endsWith("\r") ? line.slice(0, -1) : line).filter((line) => line !== "");
}

function nulRecords(text: string): string[] {
  return text.split("\0").filter((record) => record !== "");
}

function mergeSuggestions(primary: ClientFileSuggestion[], secondary: ClientFileSuggestion[]): ClientFileSuggestion[] {
  const seen = new Set<string>();
  const merged: ClientFileSuggestion[] = [];
  for (const suggestion of [...primary, ...secondary]) {
    if (seen.has(suggestion.path)) continue;
    seen.add(suggestion.path);
    merged.push(suggestion);
  }
  return merged;
}

function withDirectories(paths: string[], kind: ClientFileSuggestion["kind"]): ClientFileSuggestion[] {
  const seen = new Set<string>();
  const suggestions: ClientFileSuggestion[] = [];
  for (const path of paths) {
    for (const directory of parentDirectories(path)) add(`${directory}/`);
    add(path);
  }
  return suggestions;

  function add(path: string) {
    if (seen.has(path)) return;
    seen.add(path);
    suggestions.push({ path, kind });
  }
}

function parentDirectories(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const directories: string[] = [];
  for (let index = 1; index < parts.length; index++) {
    directories.push(parts.slice(0, index).join("/"));
  }
  return directories;
}

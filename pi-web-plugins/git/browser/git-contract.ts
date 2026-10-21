import { t } from "./i18n.js";
export const GIT_STATUS_OPERATION = "status";
export const GIT_DIFF_OPERATION = "diff";

export type GitFileState = "unmodified" | "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "ignored" | "conflicted";

export interface GitStatusFile {
  path: string;
  oldPath?: string;
  index: GitFileState;
  workingTree: GitFileState;
  submoduleFromCommit?: string;
  submoduleToCommit?: string;
}

export interface GitStatusResponse {
  isGitRepo: boolean;
  hash: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  files: GitStatusFile[];
  submodules: string[];
  truncated?: boolean;
}

export interface GitDiffResponse {
  path?: string;
  staged: boolean;
  hash: string;
  diff: string;
  truncated: boolean;
}

export function parseGitStatusResponse(value: unknown): GitStatusResponse {
  const record = requireRecord(value, t("ui.main.7486c17f15ba", "Git status response"));
  const branch = optionalString(record, "branch");
  const upstream = optionalString(record, "upstream");
  const ahead = optionalNumber(record, "ahead");
  const behind = optionalNumber(record, "behind");
  const truncated = optionalBoolean(record, "truncated");
  return {
    isGitRepo: requireBoolean(record, "isGitRepo"),
    hash: requireString(record, "hash"),
    ...(branch === undefined ? {} : { branch }),
    ...(upstream === undefined ? {} : { upstream }),
    ...(ahead === undefined ? {} : { ahead }),
    ...(behind === undefined ? {} : { behind }),
    files: requireArray(record, "files").map(parseGitStatusFile),
    submodules: record["submodules"] === undefined ? [] : requireStringArray(record["submodules"], "submodules"),
    ...(truncated === undefined ? {} : { truncated }),
  };
}

export function parseGitDiffResponse(value: unknown): GitDiffResponse {
  const record = requireRecord(value, t("ui.main.f5c4a5928162", "Git diff response"));
  const path = optionalString(record, "path");
  return {
    ...(path === undefined ? {} : { path }),
    staged: requireBoolean(record, "staged"),
    hash: requireString(record, "hash"),
    diff: requireString(record, "diff"),
    truncated: requireBoolean(record, "truncated"),
  };
}

function parseGitStatusFile(value: unknown): GitStatusFile {
  const record = requireRecord(value, t("ui.main.c15d1c2fb1e7", "Git status file"));
  const oldPath = optionalString(record, "oldPath");
  const submoduleFromCommit = optionalString(record, "submoduleFromCommit");
  const submoduleToCommit = optionalString(record, "submoduleToCommit");
  return {
    path: requireString(record, "path"),
    ...(oldPath === undefined ? {} : { oldPath }),
    index: parseGitFileState(record["index"]),
    workingTree: parseGitFileState(record["workingTree"]),
    ...(submoduleFromCommit === undefined ? {} : { submoduleFromCommit }),
    ...(submoduleToCommit === undefined ? {} : { submoduleToCommit }),
  };
}

function parseGitFileState(value: unknown): GitFileState {
  switch (value) {
    case "unmodified":
    case "modified":
    case "added":
    case "deleted":
    case "renamed":
    case "copied":
    case "untracked":
    case "ignored":
    case "conflicted":
      return value;
    default:
      throw new Error(t("ui.main.b9c6b8997acf", "Invalid Git file state"));
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(t("ui.main.0068cdba7cb2", "{arg0} must be an object", { arg0: label }));
  return value;
}

function requireArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(t("ui.main.7f27405e930e", "Field must be an array: {arg0}", { arg0: key }));
  return value;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(t("ui.main.f6d0b37d664f", "Field must be a string: {arg0}", { arg0: key }));
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(t("ui.main.7517a00e15b7", "Field must be a boolean: {arg0}", { arg0: key }));
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(t("ui.main.f6d0b37d664f", "Field must be a string: {arg0}", { arg0: key }));
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(t("ui.main.d40fe7108098", "Field must be a finite number: {arg0}", { arg0: key }));
  return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(t("ui.main.7517a00e15b7", "Field must be a boolean: {arg0}", { arg0: key }));
  return value;
}

function requireStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error(t("ui.main.141ce9c90033", "Field must be a string array: {arg0}", { arg0: key }));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

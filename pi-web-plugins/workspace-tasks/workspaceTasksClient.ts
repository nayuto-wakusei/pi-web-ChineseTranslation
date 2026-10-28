import { TASKS_CONFIG_PATH, parseTasksConfigText, type ConfigIssue, type WorkspaceTasksConfig } from "./config.js";

const missingWorkspaceFileError = "Path does not exist";

export interface WorkspaceTasksFileReader {
  readFile(path: string): Promise<WorkspaceTasksFileContent>;
  readOptionalFile?(path: string): Promise<WorkspaceTasksFileContent | undefined>;
}

interface WorkspaceTasksFileContent {
  content: string;
  truncated: boolean;
  binary: boolean;
}

export type TasksLoadIssue =
  | { kind: "read" | "unexpected"; error: string }
  | { kind: "binary" | "truncated" }
  | { kind: "config"; issue: ConfigIssue };

export type WorkspaceTasksConfigLoadResult =
  | { kind: "loaded"; config: WorkspaceTasksConfig; path: string }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: TasksLoadIssue };

export async function loadWorkspaceTasksConfig(files: WorkspaceTasksFileReader): Promise<WorkspaceTasksConfigLoadResult> {
  let file: WorkspaceTasksFileContent;
  try {
    const optionalFile = files.readOptionalFile === undefined
      ? await files.readFile(TASKS_CONFIG_PATH)
      : await files.readOptionalFile(TASKS_CONFIG_PATH);
    if (optionalFile === undefined) return { kind: "missing" };
    file = optionalFile;
  } catch (error) {
    if (error instanceof Error && error.message === missingWorkspaceFileError) return { kind: "missing" };
    return { kind: "unavailable", detail: { kind: "read", error: error instanceof Error ? error.message : String(error) } };
  }

  if (file.binary) return { kind: "unavailable", detail: { kind: "binary" } };
  if (file.truncated) return { kind: "unavailable", detail: { kind: "truncated" } };

  const result = parseTasksConfigText(file.content);
  if (!result.ok) return { kind: "unavailable", detail: { kind: "config", issue: result.error } };
  return { kind: "loaded", config: result.config, path: TASKS_CONFIG_PATH };
}

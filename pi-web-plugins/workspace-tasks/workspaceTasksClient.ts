import { TASKS_CONFIG_PATH, parseTasksConfigText, type WorkspaceTasksConfig } from "./config.js";

export const tasksConfigMissingMessage = "这里还没有配置工作区任务。";
export const tasksConfigMissingHint = `${TASKS_CONFIG_PATH} 是可选文件。如果需要自定义任务，请在当前工作区创建它。`;
export const tasksConfigUnavailableMessage = "无法加载工作区任务。";
export const tasksConfigRefreshHint = `修复 ${TASKS_CONFIG_PATH} 后点击刷新。`;

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

export type WorkspaceTasksConfigLoadResult =
  | { kind: "loaded"; config: WorkspaceTasksConfig; path: string }
  | { kind: "missing"; message: string; hint: string }
  | { kind: "unavailable"; message: string; hint: string; detail?: string };

export async function loadWorkspaceTasksConfig(files: WorkspaceTasksFileReader): Promise<WorkspaceTasksConfigLoadResult> {
  let file: WorkspaceTasksFileContent;
  try {
    const optionalFile = files.readOptionalFile === undefined
      ? await files.readFile(TASKS_CONFIG_PATH)
      : await files.readOptionalFile(TASKS_CONFIG_PATH);
    if (optionalFile === undefined) return missing();
    file = optionalFile;
  } catch (error) {
    if (errorMessage(error) === missingWorkspaceFileError) return missing();
    return unavailable(`无法读取 ${TASKS_CONFIG_PATH}: ${formatUnknownError(error)}`);
  }

  if (file.binary) return unavailable(`${TASKS_CONFIG_PATH} 必须是文本文件`);
  if (file.truncated) return unavailable(`${TASKS_CONFIG_PATH} 过大，内容已被截断`);

  const result = parseTasksConfigText(file.content);
  if (!result.ok) return unavailable(result.error);
  return { kind: "loaded", config: result.config, path: TASKS_CONFIG_PATH };
}

function missing(): WorkspaceTasksConfigLoadResult {
  return {
    kind: "missing",
    message: tasksConfigMissingMessage,
    hint: tasksConfigMissingHint,
  };
}

function unavailable(detail: string): WorkspaceTasksConfigLoadResult {
  return {
    kind: "unavailable",
    message: tasksConfigUnavailableMessage,
    hint: tasksConfigRefreshHint,
    detail,
  };
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

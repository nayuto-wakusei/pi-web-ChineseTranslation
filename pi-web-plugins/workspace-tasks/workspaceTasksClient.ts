import { t } from "./i18n.js";
import { TASKS_CONFIG_PATH, parseTasksConfigText, type WorkspaceTasksConfig } from "./config.js";

export const tasksConfigMissingMessage = () => t("bundled.workspace-tasks.no.workspace.tasks.configured.here.bb6994", "No workspace tasks configured here.");
export const tasksConfigMissingHint = () => t("bundled.workspace-tasks.is.optional.create.it.in.this.workspace.for.custom.tasks.306cdb", "{value1} is optional. Create it in this workspace for custom tasks.", { value1: TASKS_CONFIG_PATH });
export const tasksConfigUnavailableMessage = () => t("bundled.workspace-tasks.could.not.load.workspace.tasks.977b0c", "Could not load workspace tasks.");
export const tasksConfigRefreshHint = () => t("bundled.workspace-tasks.fix.then.click.refresh.04d032", "Fix {value1}, then click Refresh.", { value1: TASKS_CONFIG_PATH });

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
    return unavailable(t("bundled.workspace-tasks.unable.to.read.3b416a", "Unable to read {value1}: {value2}", { value1: TASKS_CONFIG_PATH, value2: formatUnknownError(error) }));
  }

  if (file.binary) return unavailable(t("bundled.workspace-tasks.must.be.a.text.file.3648c8", "{value1} must be a text file", { value1: TASKS_CONFIG_PATH }));
  if (file.truncated) return unavailable(t("bundled.workspace-tasks.is.too.large.and.was.truncated.ce18be", "{value1} is too large and was truncated", { value1: TASKS_CONFIG_PATH }));

  const result = parseTasksConfigText(file.content);
  if (!result.ok) return unavailable(result.error);
  return { kind: "loaded", config: result.config, path: TASKS_CONFIG_PATH };
}

function missing(): WorkspaceTasksConfigLoadResult {
  return {
    kind: "missing",
    message: tasksConfigMissingMessage(),
    hint: tasksConfigMissingHint(),
  };
}

function unavailable(detail: string): WorkspaceTasksConfigLoadResult {
  return {
    kind: "unavailable",
    message: tasksConfigUnavailableMessage(),
    hint: tasksConfigRefreshHint(),
    detail,
  };
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

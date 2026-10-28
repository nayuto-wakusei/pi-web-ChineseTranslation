export const TASKS_CONFIG_PATH = ".pi-web/tasks.json";
export const TASKS_CONFIG_VERSION = 1;

export type ConfigIssue =
  | { kind: "json"; error: string }
  | { kind: "object" | "version" | "tasks" }
  | { kind: "duplicate"; id: string }
  | { kind: "task-object" | "confirm"; index: number }
  | { kind: "id"; index: number; pattern: string }
  | { kind: "required" | "optional"; index: number; field: string };

const taskIdPattern = /^[a-z][a-z0-9.-]*$/u;

export interface WorkspaceTasksConfig {
  version: typeof TASKS_CONFIG_VERSION;
  tasks: WorkspaceTask[];
}

export interface WorkspaceTask {
  id: string;
  title: string;
  command: string;
  description?: string;
  group?: string;
  confirm: boolean;
}

export type ParseTasksConfigResult =
  | { ok: true; config: WorkspaceTasksConfig }
  | { ok: false; error: ConfigIssue };

export function parseTasksConfigText(text: string): ParseTasksConfigResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: { kind: "json", error: error instanceof Error ? error.message : String(error) } };
  }
  return parseTasksConfig(parsed);
}

export function parseTasksConfig(value: unknown): ParseTasksConfigResult {
  if (!isRecord(value)) return invalid({ kind: "object" });
  if (value["version"] !== TASKS_CONFIG_VERSION) return invalid({ kind: "version" });

  const tasks = value["tasks"];
  if (!Array.isArray(tasks)) return invalid({ kind: "tasks" });

  const ids = new Set<string>();
  const parsedTasks: WorkspaceTask[] = [];
  for (const [index, task] of tasks.entries()) {
    const parsedTask = parseTask(task, index);
    if (!parsedTask.ok) return parsedTask;
    if (ids.has(parsedTask.task.id)) return invalid({ kind: "duplicate", id: parsedTask.task.id });
    ids.add(parsedTask.task.id);
    parsedTasks.push(parsedTask.task);
  }

  return { ok: true, config: { version: TASKS_CONFIG_VERSION, tasks: parsedTasks } };
}

type ParseTaskResult =
  | { ok: true; task: WorkspaceTask }
  | { ok: false; error: ConfigIssue };

function parseTask(value: unknown, index: number): ParseTaskResult {
  index += 1;
  if (!isRecord(value)) return invalid({ kind: "task-object", index });

  const id = requireNonEmptyString(value, "id", index);
  if (!id.ok) return id;
  if (!taskIdPattern.test(id.value)) return invalid({ kind: "id", index, pattern: taskIdPattern.source });

  const title = requireNonEmptyString(value, "title", index);
  if (!title.ok) return title;

  const command = requireNonEmptyString(value, "command", index);
  if (!command.ok) return command;

  const description = optionalNonEmptyString(value, "description", index);
  if (!description.ok) return description;

  const group = optionalNonEmptyString(value, "group", index);
  if (!group.ok) return group;

  const confirm = value["confirm"];
  if (confirm !== undefined && typeof confirm !== "boolean") return invalid({ kind: "confirm", index });

  return {
    ok: true,
    task: {
      id: id.value,
      title: title.value,
      command: command.value,
      ...(description.value === undefined ? {} : { description: description.value }),
      ...(group.value === undefined ? {} : { group: group.value }),
      confirm: confirm ?? false,
    },
  };
}

type StringFieldResult =
  | { ok: true; value: string }
  | { ok: false; error: ConfigIssue };

type OptionalStringFieldResult =
  | { ok: true; value: string | undefined }
  | { ok: false; error: ConfigIssue };

function requireNonEmptyString(record: Record<string, unknown>, key: string, index: number): StringFieldResult {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") return invalid({ kind: "required", index, field: key });
  return { ok: true, value };
}

function optionalNonEmptyString(record: Record<string, unknown>, key: string, index: number): OptionalStringFieldResult {
  const value = record[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string" || value.trim() === "") return invalid({ kind: "optional", index, field: key });
  return { ok: true, value };
}

function invalid(error: ConfigIssue): { ok: false; error: ConfigIssue } {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

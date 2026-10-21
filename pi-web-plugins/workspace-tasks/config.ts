import { t } from "./i18n.js";
export const TASKS_CONFIG_PATH = ".pi-web/tasks.json";
export const TASKS_CONFIG_VERSION = 1;

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
  | { ok: false; error: string };

export function parseTasksConfigText(text: string): ParseTasksConfigResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: t("bundled.workspace-tasks.invalid.json.17242b", "Invalid JSON: {value1}", { value1: error instanceof Error ? error.message : String(error) }) };
  }
  return parseTasksConfig(parsed);
}

export function parseTasksConfig(value: unknown): ParseTasksConfigResult {
  if (!isRecord(value)) return invalid(t("bundled.workspace-tasks.config.must.be.an.object.ac0503", "Config must be an object"));
  if (value["version"] !== TASKS_CONFIG_VERSION) return invalid(t("bundled.workspace-tasks.config.version.must.be.1.ca03d7", "Config version must be 1"));

  const tasks = value["tasks"];
  if (!Array.isArray(tasks)) return invalid(t("bundled.workspace-tasks.config.tasks.must.be.an.array.5c6ec9", "Config tasks must be an array"));

  const ids = new Set<string>();
  const parsedTasks: WorkspaceTask[] = [];
  for (const [index, task] of tasks.entries()) {
    const parsedTask = parseTask(task, index);
    if (!parsedTask.ok) return parsedTask;
    if (ids.has(parsedTask.task.id)) return invalid(t("bundled.workspace-tasks.duplicate.task.id.bd4749", "Duplicate task id: {value1}", { value1: parsedTask.task.id }));
    ids.add(parsedTask.task.id);
    parsedTasks.push(parsedTask.task);
  }

  return { ok: true, config: { version: TASKS_CONFIG_VERSION, tasks: parsedTasks } };
}

type ParseTaskResult =
  | { ok: true; task: WorkspaceTask }
  | { ok: false; error: string };

function parseTask(value: unknown, index: number): ParseTaskResult {
  const label = t("bundled.workspace-tasks.task.17bccc", "Task {value1}", { value1: String(index + 1) });
  if (!isRecord(value)) return invalid(t("bundled.workspace-tasks.must.be.an.object.f7baec", "{value1} must be an object", { value1: label }));

  const id = requireNonEmptyString(value, "id", label);
  if (!id.ok) return id;
  if (!taskIdPattern.test(id.value)) return invalid(t("bundled.workspace-tasks.id.must.match.8c38f3", "{value1} id must match {value2}", { value1: label, value2: taskIdPattern.source }));

  const title = requireNonEmptyString(value, "title", label);
  if (!title.ok) return title;

  const command = requireNonEmptyString(value, "command", label);
  if (!command.ok) return command;

  const description = optionalNonEmptyString(value, "description", label);
  if (!description.ok) return description;

  const group = optionalNonEmptyString(value, "group", label);
  if (!group.ok) return group;

  const confirm = value["confirm"];
  if (confirm !== undefined && typeof confirm !== "boolean") return invalid(t("bundled.workspace-tasks.confirm.must.be.a.boolean.f785a1", "{value1} confirm must be a boolean", { value1: label }));

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
  | { ok: false; error: string };

type OptionalStringFieldResult =
  | { ok: true; value: string | undefined }
  | { ok: false; error: string };

function requireNonEmptyString(record: Record<string, unknown>, key: string, label: string): StringFieldResult {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") return invalid(t("bundled.workspace-tasks.must.be.a.non.empty.string.838d0a", "{value1} {value2} must be a non-empty string", { value1: label, value2: key }));
  return { ok: true, value };
}

function optionalNonEmptyString(record: Record<string, unknown>, key: string, label: string): OptionalStringFieldResult {
  const value = record[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string" || value.trim() === "") return invalid(t("bundled.workspace-tasks.must.be.a.non.empty.string.when.provided.a6f9ee", "{value1} {value2} must be a non-empty string when provided", { value1: label, value2: key }));
  return { ok: true, value };
}

function invalid(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

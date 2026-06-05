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
    return { ok: false, error: `JSON 无效: ${error instanceof Error ? error.message : String(error)}` };
  }
  return parseTasksConfig(parsed);
}

export function parseTasksConfig(value: unknown): ParseTasksConfigResult {
  if (!isRecord(value)) return invalid("配置必须是对象");
  if (value["version"] !== TASKS_CONFIG_VERSION) return invalid("配置 version 必须是 1");

  const tasks = value["tasks"];
  if (!Array.isArray(tasks)) return invalid("配置 tasks 必须是数组");

  const ids = new Set<string>();
  const parsedTasks: WorkspaceTask[] = [];
  for (const [index, task] of tasks.entries()) {
    const parsedTask = parseTask(task, index);
    if (!parsedTask.ok) return parsedTask;
    if (ids.has(parsedTask.task.id)) return invalid(`任务 id 重复: ${parsedTask.task.id}`);
    ids.add(parsedTask.task.id);
    parsedTasks.push(parsedTask.task);
  }

  return { ok: true, config: { version: TASKS_CONFIG_VERSION, tasks: parsedTasks } };
}

type ParseTaskResult =
  | { ok: true; task: WorkspaceTask }
  | { ok: false; error: string };

function parseTask(value: unknown, index: number): ParseTaskResult {
  const label = `任务 ${String(index + 1)}`;
  if (!isRecord(value)) return invalid(`${label} 必须是对象`);

  const id = requireNonEmptyString(value, "id", label);
  if (!id.ok) return id;
  if (!taskIdPattern.test(id.value)) return invalid(`${label} id 必须匹配 ${taskIdPattern.source}`);

  const title = requireNonEmptyString(value, "title", label);
  if (!title.ok) return title;

  const command = requireNonEmptyString(value, "command", label);
  if (!command.ok) return command;

  const description = optionalNonEmptyString(value, "description", label);
  if (!description.ok) return description;

  const group = optionalNonEmptyString(value, "group", label);
  if (!group.ok) return group;

  const confirm = value["confirm"];
  if (confirm !== undefined && typeof confirm !== "boolean") return invalid(`${label} confirm 必须是布尔值`);

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
  if (typeof value !== "string" || value.trim() === "") return invalid(`${label} ${key} 必须是非空字符串`);
  return { ok: true, value };
}

function optionalNonEmptyString(record: Record<string, unknown>, key: string, label: string): OptionalStringFieldResult {
  const value = record[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string" || value.trim() === "") return invalid(`${label} ${key} 提供时必须是非空字符串`);
  return { ok: true, value };
}

function invalid(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

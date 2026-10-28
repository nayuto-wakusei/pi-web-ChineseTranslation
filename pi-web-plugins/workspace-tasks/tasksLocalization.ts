import type { PluginLocalization } from "@chainingintention/pi-web-cn/plugin-api";
import { TASKS_CONFIG_PATH, TASKS_CONFIG_VERSION, type ConfigIssue } from "./config.js";
import definitions from "./tasks.messages.js";
import type { TasksLoadIssue } from "./workspaceTasksClient.js";

export function createTasksLocalization(localization: PluginLocalization) {
  const messages = localization.registerMessages("tasks", definitions);
  return {
    localization,
    messages,
    loadIssue: (issue: TasksLoadIssue): string => {
      switch (issue.kind) {
        case "read": return messages.t("readError", { path: TASKS_CONFIG_PATH, error: issue.error });
        case "unexpected": return issue.error;
        case "binary": return messages.t("binary", { path: TASKS_CONFIG_PATH });
        case "truncated": return messages.t("truncated", { path: TASKS_CONFIG_PATH });
        case "config": return configIssue(issue.issue);
      }
    },
  };

  function configIssue(issue: ConfigIssue): string {
    switch (issue.kind) {
      case "json": return messages.t("invalidJson", { error: issue.error });
      case "object": return messages.t("configObject");
      case "version": return messages.t("configVersion", { version: TASKS_CONFIG_VERSION });
      case "tasks": return messages.t("configTasks");
      case "duplicate": return messages.t("duplicate", { id: issue.id });
      case "task-object": return messages.t("taskObject", { index: issue.index });
      case "id": return messages.t("taskId", { index: issue.index, pattern: issue.pattern });
      case "required": return messages.t("requiredField", { index: issue.index, field: issue.field });
      case "optional": return messages.t("optionalField", { index: issue.index, field: issue.field });
      case "confirm": return messages.t("taskConfirm", { index: issue.index });
    }
  }
}

export type TasksLocalization = ReturnType<typeof createTasksLocalization>;

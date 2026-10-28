import { afterEach, describe, expect, it } from "vitest";
import { LocalizationService } from "../../src/client/src/localization/service.js";
import { createPluginLocalization } from "../../src/client/src/plugins/localization.js";
import { parseTasksConfigText } from "./config.js";
import { createTasksLocalization } from "./tasksLocalization.js";

const lifetimes: AbortController[] = [];
afterEach(() => {
  for (const lifetime of lifetimes.splice(0)) lifetime.abort();
});

function fixture() {
  const service = new LocalizationService({ preferences: { language: "en", formatLocale: "de-DE" } });
  const lifetime = new AbortController();
  lifetimes.push(lifetime);
  const localization = createPluginLocalization(service, "workspace-tasks", "workspace-tasks", lifetime.signal);
  return { service, ...createTasksLocalization(localization) };
}

describe("Tasks diagnostics and formatting", () => {
  it.each([
    [null, "Config must be an object"],
    [{ version: 2 }, "Config version must be 1"],
    [{ version: 1 }, "Config tasks must be an array"],
    [{ version: 1, tasks: [null] }, "Task 1 must be an object"],
    [{ version: 1, tasks: [{ id: "bad id" }] }, "Task 1 id must match ^[a-z][a-z0-9.-]*$"],
    [{ version: 1, tasks: [{ id: "good" }] }, "Task 1 title must be a non-empty string"],
    [{ version: 1, tasks: [{ id: "good", title: "Good", command: "cmd", description: false }] }, "Task 1 description must be a non-empty string when provided"],
    [{ version: 1, tasks: [{ id: "good", title: "Good", command: "cmd", confirm: "yes" }] }, "Task 1 confirm must be a boolean"],
    [{ version: 1, tasks: [{ id: "same", title: "One", command: "cmd" }, { id: "same", title: "Two", command: "cmd" }] }, "Duplicate task id: same"],
  ])("formats structured config validation for %j", (input, expected) => {
    const { loadIssue } = fixture();
    const result = parseTasksConfigText(JSON.stringify(input));
    if (result.ok) throw new Error("Expected invalid tasks configuration");
    expect(loadIssue({ kind: "config", issue: result.error })).toBe(expected);
  });

  it("formats native parser details, file failures, plurals and regional numbers", () => {
    const { messages, loadIssue } = fixture();
    const invalid = parseTasksConfigText("{");
    if (invalid.ok || invalid.error.kind !== "json") throw new Error("Expected JSON diagnostic");
    expect(loadIssue({ kind: "config", issue: invalid.error })).toBe(`Invalid JSON: ${invalid.error.error}`);
    expect(loadIssue({ kind: "binary" })).toBe(".pi-web/tasks.json must be a text file");
    expect(loadIssue({ kind: "truncated" })).toBe(".pi-web/tasks.json is too large and was truncated");
    expect(loadIssue({ kind: "read", error: "Backend <error>" })).toBe("Unable to read .pi-web/tasks.json: Backend <error>");
    expect(loadIssue({ kind: "unexpected", error: "Backend <error>" })).toBe("Backend <error>");
    expect(messages.t("loaded", { count: 1 })).toBe("Loaded 1 task.");
    expect(messages.t("loaded", { count: 1234 })).toBe("Loaded 1.234 tasks.");
    expect(loadIssue({ kind: "config", issue: { kind: "required", index: 1234, field: "command" } })).toBe("Task 1.234 command must be a non-empty string");
  });
});

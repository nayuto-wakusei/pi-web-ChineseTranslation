import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api";
import { PromptEditor } from "./PromptEditor";

afterEach(() => { vi.restoreAllMocks(); });

it("keeps all matching command completions beyond twelve", async () => {
  const skills = Array.from({ length: 40 }, (_, index) => ({
    name: `skill:example-${String(index + 1).padStart(2, "0")}`,
    source: "skill" as const,
  }));
  vi.spyOn(api, "commands").mockResolvedValue(skills);
  const editor = new PromptEditor();
  editor.sessionId = "session-1";
  editor.cwd = "/repo";
  Reflect.set(editor, "draft", "/skill:");
  const refresh: unknown = Reflect.get(editor, "refreshCompletions");
  if (typeof refresh !== "function") throw new Error("PromptEditor.refreshCompletions is not callable");
  await refresh.call(editor);

  const completions: unknown = Reflect.get(editor, "completions");
  expect(completions).toEqual(skills.map((skill) => ({
    kind: "command", replaceFrom: 0, replaceTo: 7, insertText: `/${skill.name}`, detail: "skill",
  })));
});

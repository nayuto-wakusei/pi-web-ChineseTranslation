import { afterEach, describe, expect, it } from "vitest";
import * as updates from "./updates/i18n.js";
import * as tasks from "./workspace-tasks/i18n.js";
import { chinesePluginLocalization, translateChinese } from "./localization.testSupport.js";
import { createInfoContent } from "./info/infoInternals.js";
import { loadWorkspaceTasksConfig } from "./workspace-tasks/workspaceTasksClient.js";

const translators = [updates, tasks];

afterEach(() => {
  for (const translator of translators) translator.setTranslator(undefined);
});

describe("bundled plugin localization", () => {
  it("falls back to English and interpolates on older hosts", () => {
    for (const translator of translators) {
      translator.setTranslator(undefined);
      expect(translator.t("missing", "Hello {name}", { name: "<user>" })).toBe("Hello <user>");
    }
  });

  it("uses the activation translator without translating runtime values", async () => {
    const { releaseSummary } = createInfoContent(await chinesePluginLocalization("info"));
    expect(releaseSummary({ packageName: "pi-web", updateAvailable: false, error: "user: <custom>" })).toBe("更新检查失败：user: <custom>");
  });

  it("keeps task load results independent of the display language", async () => {
    const files = { readFile: () => Promise.reject(new Error("Path does not exist")) };
    tasks.setTranslator(translateChinese);
    await expect(loadWorkspaceTasksConfig(files)).resolves.toEqual({ kind: "missing" });
    tasks.setTranslator(undefined);
    await expect(loadWorkspaceTasksConfig(files)).resolves.toEqual({ kind: "missing" });
  });
});

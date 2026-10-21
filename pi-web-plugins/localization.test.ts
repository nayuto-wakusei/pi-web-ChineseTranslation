import { afterEach, describe, expect, it } from "vitest";
import * as info from "./info/i18n.js";
import * as updates from "./updates/i18n.js";
import * as tasks from "./workspace-tasks/i18n.js";
import * as relays from "./relays/i18n.js";
import { translateChinese } from "./localization.testSupport.js";
import { releaseSummary } from "./info/infoInternals.js";
import { loadWorkspaceTasksConfig } from "./workspace-tasks/workspaceTasksClient.js";

const translators = [info, updates, tasks, relays];

afterEach(() => {
  for (const translator of translators) translator.setTranslator(undefined);
});

describe("bundled plugin localization", () => {
  it("falls back to English and interpolates on older hosts", () => {
    for (const translator of translators) {
      translator.setTranslator(undefined);
      expect(translator.t("missing", "Hello {name}", { name: "<user>" })).toBe("Hello <user>");
    }
    expect(releaseSummary({ packageName: "pi-web", updateAvailable: true, latestVersion: "1.2.3" })).toBe("Update available: 1.2.3");
  });

  it("uses the activation translator without translating runtime values", () => {
    info.setTranslator(translateChinese);
    expect(releaseSummary({ packageName: "pi-web", updateAvailable: false, error: "user: <custom>" })).toBe("更新检查失败：user: <custom>");
  });

  it("resolves task notices after activation rather than at module import", async () => {
    const files = { readFile: () => Promise.reject(new Error("Path does not exist")) };
    tasks.setTranslator(translateChinese);
    await expect(loadWorkspaceTasksConfig(files)).resolves.toMatchObject({ kind: "missing", message: "这里还没有配置工作区任务。" });
    tasks.setTranslator(undefined);
    await expect(loadWorkspaceTasksConfig(files)).resolves.toMatchObject({ kind: "missing", message: "No workspace tasks configured here." });
  });
});

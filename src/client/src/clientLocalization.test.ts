import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../pi-web-plugins/zh-cn/client.json";
import catalogs from "../../../pi-web-plugins/zh-cn/catalogs.json";
import { localization } from "./localization/browser";
import { setClientTranslations } from "./i18n";
import { notificationSeverityLabel } from "./sessionNotifications";
import { sessionCleanupUnavailableMessage } from "./sessionCleanupUi";

const releases: (() => void)[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  setClientTranslations("zh-CN", messages);
});

describe("client display localization", () => {
  it("renders English when the language plugin is disabled", async () => {
    await localization.setPreferences({ language: "en", formatLocale: "en" });
    setClientTranslations("en", {});
    expect(notificationSeverityLabel("warning")).toBe("Warning");
    expect(sessionCleanupUnavailableMessage("remote-host")).toBe("Update and restart Pi-Web on remote-host before cleaning up sessions.");
  });

  it("renders Chinese and preserves machine names as data", async () => {
    for (const [namespace, catalog] of Object.entries(catalogs)) {
      releases.push(localization.registerCatalog({ id: `zh-cn:${namespace}`, namespace, locale: "zh-CN", load: () => Promise.resolve(catalog) }));
    }
    await localization.setPreferences({ language: "zh-CN", formatLocale: "zh-CN" });
    setClientTranslations("zh-CN", messages);
    expect(notificationSeverityLabel("warning")).toBe("警告");
    expect(sessionCleanupUnavailableMessage("remote <host>")).toBe("请更新并重启 remote <host> 上的 Pi-Web 后再清理会话。");
  });
});

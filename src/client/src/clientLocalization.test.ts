import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../pi-web-plugins/zh-cn/client.json";
import { setClientTranslations } from "./i18n";
import { notificationSeverityLabel } from "./sessionNotifications";
import { sessionCleanupUnavailableMessage } from "./sessionCleanupUi";

afterEach(() => { setClientTranslations("zh-CN", messages); });

describe("client display localization", () => {
  it("renders English when the language plugin is disabled", () => {
    setClientTranslations("en", {});
    expect(notificationSeverityLabel("warning")).toBe("Warning");
    expect(sessionCleanupUnavailableMessage("remote-host")).toBe("Update and restart Pi-Web on remote-host before cleaning up sessions.");
  });

  it("renders Chinese and preserves machine names as data", () => {
    setClientTranslations("zh-CN", messages);
    expect(notificationSeverityLabel("warning")).toBe("警告");
    expect(sessionCleanupUnavailableMessage("remote <host>")).toBe("请更新并重启 remote <host> 上的 Pi-Web 后再清理会话。");
  });
});

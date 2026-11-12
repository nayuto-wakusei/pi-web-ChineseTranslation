// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientLocale, setClientTranslations, t } from "./i18n";
import { applyDocumentLocalization, hasBootstrappedChineseLocalization, initializeClientLocalization } from "./localizationBootstrap";
import type { PiWebPluginRegistration } from "./plugins/types";
import chinesePlugin from "../../../pi-web-plugins/zh-cn/pi-web-plugin";
import { localization } from "./localization/browser";
import "./authMessages";

function languagePlugin(machineId?: string): PiWebPluginRegistration {
  return {
    id: "zh-cn",
    ...(machineId === undefined ? {} : { machineId }),
    plugin: {
      apiVersion: 4,
      name: "Chinese",
      activate: () => ({ contributions: { localizations: [{ locale: "zh-CN", messages: { hello: "你好", "app.description": "中文介绍" } }] } }),
    },
  };
}

afterEach(() => {
  setClientTranslations("en", {});
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("gateway localization bootstrap", () => {
  it("initializes Chinese before consumers evaluate their labels", async () => {
    await initializeClientLocalization(() => Promise.resolve([{ id: "zh-cn", plugin: chinesePlugin }]));
    expect(hasBootstrappedChineseLocalization()).toBe(true);
    expect(t("ui.common.close", "Close")).toBe("关闭");
    expect(clientLocale()).toBe("zh-CN");
    await localization.setPreferences({ language: "zh-CN", formatLocale: "zh-CN" });
    await localization.setPreferences({ language: "en", formatLocale: "en" });
    expect(t("ui.common.close", "Close")).toBe("Close");
    await localization.setPreferences({ language: "zh-CN", formatLocale: "zh-CN" });
    expect(t("ui.common.close", "Close")).toBe("关闭");
    await localization.setPreferences({ language: "ar", formatLocale: "ar" });
    expect(t("ui.common.close", "Close")).toBe("Close");
    expect(document.documentElement.lang).toBe(localization.language);
  });

  it("uses English when disabled and never adopts remote-machine translations", async () => {
    await initializeClientLocalization(() => Promise.resolve([languagePlugin()]));
    await initializeClientLocalization(() => Promise.resolve([]));
    expect(hasBootstrappedChineseLocalization()).toBe(false);
    expect(t("hello", "Hello")).toBe("Hello");
    await initializeClientLocalization(() => Promise.resolve([languagePlugin("remote")]));
    expect(t("hello", "Hello")).toBe("Hello");
  });

  it("keeps the app usable when loading the language pack fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await initializeClientLocalization(() => Promise.reject(new Error("offline")));
    expect(hasBootstrappedChineseLocalization()).toBe(false);
    expect(clientLocale()).toBe("en");
  });

  it("updates document and install metadata and restores the English manifest", async () => {
    document.head.innerHTML = '<meta name="description"><link rel="manifest">';
    await initializeClientLocalization(() => Promise.resolve([languagePlugin()]));
    applyDocumentLocalization(document);
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.querySelector<HTMLMetaElement>("meta")?.content).toBe("中文介绍");
    expect(document.querySelector<HTMLLinkElement>("link")?.href).toContain("pi-web-plugins/zh-cn/manifest.webmanifest");
    await initializeClientLocalization(() => Promise.resolve([]));
    applyDocumentLocalization(document);
    expect(document.documentElement.lang).toBe("en");
    expect(document.querySelector<HTMLLinkElement>("link")?.href).not.toContain("zh-cn");
  });
});

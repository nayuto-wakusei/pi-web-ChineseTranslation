import { html, svg } from "lit";
import { resolveAppUrl } from "./appUrl";
import { clientLocale, setClientTranslations, t } from "./i18n";
import { loadExternalPlugins } from "./plugins/external";
import type { PiWebPluginRegistration } from "./plugins/types";
import { localization } from "./localization/browser";
import { createPluginLocalization } from "./plugins/localization";

let localizationLifetime: AbortController | undefined;
let unsubscribeLegacyLocale: (() => void) | undefined;

export async function initializeClientLocalization(
  load: () => Promise<PiWebPluginRegistration[]> = async () => (await loadExternalPlugins(
    "pi-web-plugins/localization.json",
    { shouldLoadPlugin: (entry) => entry.id === "zh-cn" },
  )).registrations,
): Promise<void> {
  localizationLifetime?.abort();
  unsubscribeLegacyLocale?.();
  unsubscribeLegacyLocale = undefined;
  setClientTranslations("en", {});
  try {
    const registrations = await load();
    const registration = registrations.find((entry) => entry.id === "zh-cn" && entry.machineId === undefined);
    if (registration !== undefined) {
      const controller = new AbortController();
      localizationLifetime = controller;
      const result = await registration.plugin.activate({ apiVersion: 5, pluginId: registration.id, runtimePluginId: registration.id, html, svg, translate: t, localization: createPluginLocalization(localization, registration.id, registration.id, controller.signal), signal: controller.signal, lifetimeSignal: controller.signal });
      const chinese = result.contributions.localizations?.find((entry) => entry.locale === "zh-CN");
      if (chinese !== undefined) {
        setClientTranslations(chinese.locale, chinese.messages);
        unsubscribeLegacyLocale = localization.subscribe(() => {
          const language = localization.language.toLowerCase().startsWith("zh") ? chinese.locale : "en";
          if (clientLocale() === language) return;
          setClientTranslations(language, language === chinese.locale ? chinese.messages : {});
          if (typeof document !== "undefined") {
            applyDocumentLocalization(document);
            document.documentElement.lang = localization.language;
          }
        });
      }
    }
  } catch (error) {
    // An unavailable language pack must not prevent login or use of the application.
    console.warn("Could not initialize UI localization; using English", error);
  }
}

export function applyDocumentLocalization(document: Document): void {
  document.documentElement.lang = clientLocale();
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (description !== null) {
    description.content = t("app.description", "Remote web UI and browser control plane for persistent Pi Coding Agent sessions.");
  }
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifest !== null) {
    manifest.href = resolveAppUrl(clientLocale() === "zh-CN"
      ? "pi-web-plugins/zh-cn/manifest.webmanifest"
      : "manifest.webmanifest");
  }
}

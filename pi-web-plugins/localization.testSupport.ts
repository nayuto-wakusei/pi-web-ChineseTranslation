import bundled from "./zh-cn/bundled.json";
import main from "./zh-cn/main.json";
import server from "./zh-cn/server.json";
import serverMain from "./zh-cn/server-main.json";
import components from "./zh-cn/components.json";
import client from "./zh-cn/client.json";
import catalogs from "./zh-cn/catalogs.json";
import { LocalizationService } from "../src/client/src/localization/service.js";
import { createPluginLocalization } from "../src/client/src/plugins/localization.js";
const dictionary = { ...bundled, ...main, ...server, ...serverMain, ...components, ...client };

export async function chinesePluginLocalization(pluginId: string) {
  return (await chinesePluginLocalizationFactory(pluginId))();
}

export async function chinesePluginLocalizationFactory(pluginId: string) {
  const service = new LocalizationService({ preferences: { language: "zh-CN", formatLocale: "zh-CN" } });
  for (const [namespace, catalog] of Object.entries(catalogs)) {
    service.registerCatalog({ id: namespace, namespace, locale: "zh-CN", load: () => Promise.resolve(catalog) });
  }
  await service.ready;
  return () => createPluginLocalization(service, pluginId, pluginId, new AbortController().signal);
}

export function translateChinese(key: string, fallback: string, params?: Readonly<Record<string, string | number>>): string {
  const messages: Readonly<Record<string, string>> = dictionary;
  return (messages[key] ?? fallback).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => String(params?.[name] ?? match));
}

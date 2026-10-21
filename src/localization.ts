import { existsSync, readFileSync } from "node:fs";
import { loadPiWebConfig, type PiWebConfig } from "./config.js";
import { createTranslator, parseTranslationMessages, type Translator } from "./shared/i18n.js";

/** Node processes read only bundled dictionary data, never browser plugin code. */
export function loadNodeTranslator(
  domain: "server" | "cli",
  config: Pick<PiWebConfig, "plugins"> = loadPiWebConfig().config,
): Translator {
  if (config.plugins?.["zh-cn"]?.enabled === false) return createTranslator("en", {});
  const messages: Record<string, string> = {};
  for (const catalog of domain === "server" ? ["server", "auth", "provider-auth", "files", "routing", "config-errors", "management-errors", "machines", "projects"] : ["cli"]) {
    const built = new URL(`./pi-web-plugins/zh-cn/${catalog}.json`, import.meta.url);
    const source = new URL(`../pi-web-plugins/zh-cn/${catalog}.json`, import.meta.url);
    const path = existsSync(built) ? built : source;
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      Object.assign(messages, parseTranslationMessages(value));
    } catch {
      // A missing optional language asset must not prevent service recovery.
      console.warn(`PI WEB could not load the ${catalog} localization catalog; using English for its messages.`);
    }
  }
  return createTranslator("zh-CN", messages);
}

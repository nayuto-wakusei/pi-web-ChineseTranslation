import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setClientTranslations } from "../client/src/i18n";
import { parseTranslationMessages } from "../shared/i18n";

// Most existing UI tests exercise the shipped, Chinese-enabled configuration.
const messages: Record<string, string> = {};
for (const name of ["components", "client", "bundled", "metadata"]) {
  Object.assign(messages, parseTranslationMessages(JSON.parse(readFileSync(resolve("pi-web-plugins/zh-cn", `${name}.json`), "utf8"))));
}
setClientTranslations("zh-CN", messages);

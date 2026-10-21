import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setClientTranslations } from "../client/src/i18n";
import { createTranslator, parseTranslationMessages } from "../shared/i18n";
import { setTranslator as setFiles } from "../../pi-web-plugins/files/i18n.js";
import { setTranslator as setGitBrowser } from "../../pi-web-plugins/git/browser/i18n.js";
import { setTranslator as setTerminalServer } from "../../pi-web-plugins/terminal/server/i18n.js";
import { setTranslator as setGit } from "../../pi-web-plugins/git/i18n.js";
import { setTranslator as setTerminal } from "../../pi-web-plugins/terminal/i18n.js";
import { setTranslator as setInfo } from "../../pi-web-plugins/info/i18n.js";
import { setTranslator as setUpdates } from "../../pi-web-plugins/updates/i18n.js";
import { setTranslator as setTasks } from "../../pi-web-plugins/workspace-tasks/i18n.js";
import { setTranslator as setMermaid } from "../../pi-web-plugins/mermaid/i18n.js";
import { setTranslator as setRelays } from "../../pi-packages/relays/i18n.js";
import { setTranslator as setCaptain } from "../../pi-packages/captains-log/i18n.js";

// Most existing UI tests exercise the shipped, Chinese-enabled configuration.
const messages: Record<string, string> = {};
for (const name of ["components", "client", "bundled", "metadata", "main", "server", "server-main"]) {
  Object.assign(messages, parseTranslationMessages(JSON.parse(readFileSync(resolve("pi-web-plugins/zh-cn", `${name}.json`), "utf8"))));
}
setClientTranslations("zh-CN", messages);
for (const set of [setGitBrowser, setTerminalServer, setFiles, setGit, setTerminal, setInfo, setUpdates, setTasks, setMermaid, setRelays, setCaptain]) {
  set(createTranslator("zh-CN", messages));
}

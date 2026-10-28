import type { PluginLocalization } from "@chainingintention/pi-web-cn/plugin-api";
import definitions from "./mermaid.messages";

export function createMermaidContent(localization: PluginLocalization) {
  return { localization, messages: localization.registerMessages("preview", definitions) };
}

export type MermaidContent = ReturnType<typeof createMermaidContent>;

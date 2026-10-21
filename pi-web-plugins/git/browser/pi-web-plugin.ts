import { setTranslator } from "./i18n.js";
import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import { createGitBrowserContributions } from "./git-panel.js";

const plugin = {
  apiVersion: 4,
  name: "Git",
  activate: ({ pluginId, runtimePluginId, html, svg, translate }) => { setTranslator(translate); return ({
    contributions: createGitBrowserContributions(pluginId, runtimePluginId, html, svg),
  }); },
} satisfies PiWebPlugin;

export default plugin;

import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import { createGitBrowserContributions } from "./git-panel.js";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Git",
  activate: ({ pluginId, runtimePluginId, html, svg }) => ({
    contributions: createGitBrowserContributions(pluginId, runtimePluginId ?? pluginId, html, svg),
  }),
};

export default plugin;

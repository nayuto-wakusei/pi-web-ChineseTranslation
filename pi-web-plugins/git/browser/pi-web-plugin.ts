import type { FileIconsCapability, PiWebPlugin, PluginCapability, StylesheetIntegrationCapabilityV1 } from "@chainingintention/pi-web-cn/plugin-api";
import { createGitBrowserContributions } from "./git-panel.js";
import { setTranslator } from "./i18n.js";

const stylesheetIntegrationCapability: PluginCapability<StylesheetIntegrationCapabilityV1, 1> = {
  pluginId: "pi-web", id: "stylesheet-integration", version: 1,
  parse: (value) => {
    if (!isStylesheetIntegration(value)) {
      throw new Error("Invalid PI WEB stylesheet integration capability v1");
    }
    return value;
  },
};

function isStylesheetIntegration(value: unknown): value is StylesheetIntegrationCapabilityV1 {
  return typeof value === "object" && value !== null
    && "registerRoot" in value && typeof value.registerRoot === "function"
    && "subscribe" in value && typeof value.subscribe === "function"
    && "createController" in value && typeof value.createController === "function";
}

const fileIconsCapability: PluginCapability<FileIconsCapability> = {
  pluginId: "pi-web", id: "file-icons", version: 1,
  parse(value) {
    if (!isFileIcons(value)) throw new Error("Invalid PI WEB file icons capability v1");
    return value;
  },
};

function isFileIcons(value: unknown): value is FileIconsCapability {
  return typeof value === "object" && value !== null
    && "resolveIcon" in value && typeof value.resolveIcon === "function"
    && "subscribe" in value && typeof value.subscribe === "function";
}

const plugin = {
  apiVersion: 4,
  name: "Git",
  requires: [stylesheetIntegrationCapability, fileIconsCapability],
  activate: ({ pluginId, runtimePluginId, html, svg, localization, translate }) => {
    setTranslator(translate);
    if (localization === undefined) throw new Error("The Git plugin requires a localization-capable PI WEB host");
    let stylesheetIntegration: StylesheetIntegrationCapabilityV1 | undefined;
    let fileIcons: FileIconsCapability | undefined;
    return {
      start: ({ capabilities }) => {
        stylesheetIntegration = capabilities.resolve(stylesheetIntegrationCapability);
        fileIcons = capabilities.resolve(fileIconsCapability);
      },
      contributions: createGitBrowserContributions(pluginId, runtimePluginId, html, svg, () => stylesheetIntegration, localization, () => fileIcons),
    };
  },
} satisfies PiWebPlugin;

export default plugin;

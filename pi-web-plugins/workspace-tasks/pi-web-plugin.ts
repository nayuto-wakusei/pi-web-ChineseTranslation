import type { StylesheetIntegrationCapabilityV1, PiWebPlugin, PluginCapability } from "@chainingintention/pi-web-cn/plugin-api";
import { createTasksLocalization } from "./tasksLocalization.js";
import { TASKS_CONFIG_PATH } from "./config.js";
import { defineTasksPanelElement, tasksPanelBadge } from "./tasksPanelElement.js";
import { setTranslator } from "./i18n.js";

const stylesheetIntegrationCapability: PluginCapability<StylesheetIntegrationCapabilityV1, 1> = {
  pluginId: "pi-web", id: "stylesheet-integration", version: 1,
  parse(value) {
    if (!isStylesheetIntegration(value)) {
      throw new Error("Stylesheet integration capability v1 requires registerRoot and createController");
    }
    return value;
  },
};

function isStylesheetIntegration(value: unknown): value is StylesheetIntegrationCapabilityV1 {
  return typeof value === "object" && value !== null
    && "registerRoot" in value && typeof value.registerRoot === "function"
    && "createController" in value && typeof value.createController === "function"
    && "subscribe" in value && typeof value.subscribe === "function";
}

const plugin = {
  apiVersion: 4,
  name: "Workspace tasks",
  requires: [stylesheetIntegrationCapability],
  activate: ({ runtimePluginId, html, svg, localization, translate }) => {
    setTranslator(translate);
    if (localization === undefined) throw new Error("The Workspace Tasks plugin requires a localization-capable PI WEB host");
    const translations = createTasksLocalization(localization);
    const { messages } = translations;
    defineTasksPanelElement();
    let stylesheetIntegration: StylesheetIntegrationCapabilityV1 | undefined;

    return {
      start({ capabilities }) {
        stylesheetIntegration = capabilities.resolve(stylesheetIntegrationCapability);
      },
      contributions: {
        actions: [
          {
            id: "workspace.open-tasks",
            get title() { return messages.t("openTasks"); },
            get description() { return messages.t("openDescription", { path: TASKS_CONFIG_PATH }); },
            get group() { return messages.t("workspace"); },
            enabled: (context) => context.state.selectedWorkspace !== undefined,
            run: (context) => {
              if (context.state.selectedWorkspace === undefined) return;
              context.selectWorkspaceTool(`${runtimePluginId}:workspace.tasks`);
            },
          },
        ],
        workspacePanels: [
          {
            id: "workspace.tasks",
            get title() { return messages.t("tasks"); },
            icon: svg`
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 6h11"></path>
                <path d="M9 12h11"></path>
                <path d="M9 18h11"></path>
                <path d="m4 6 .8 .8L6.5 5"></path>
                <path d="m4 12 .8 .8 1.7-1.8"></path>
                <path d="m4 18 .8 .8 1.7-1.8"></path>
              </svg>
            `,
            order: 40,
            badge: (context) => tasksPanelBadge(context),
            render: (context) => html`<pi-web-workspace-tasks-panel .translations=${translations} .stylesheetIntegration=${stylesheetIntegration} .context=${context}></pi-web-workspace-tasks-panel>`,
          },
        ],
      },
    };
  },
} satisfies PiWebPlugin;

export default plugin;

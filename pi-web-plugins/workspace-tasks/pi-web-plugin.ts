import { t, setTranslator } from "./i18n.js";
import type { StylesheetIntegrationCapabilityV1, PiWebPlugin, PluginCapability } from "@chainingintention/pi-web-cn/plugin-api";
import { TASKS_CONFIG_PATH } from "./config.js";
import { defineTasksPanelElement, tasksPanelBadge } from "./tasksPanelElement.js";

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

const plugin: Extract<PiWebPlugin, { apiVersion: 4 }> = {
  apiVersion: 4,
  name: t("bundled.workspace-tasks.workspace.tasks.b4ef49", "Workspace tasks"),
  requires: [stylesheetIntegrationCapability],
  activate: ({ runtimePluginId, html, svg, translate }) => {
    setTranslator(translate);
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
            title: t("bundled.workspace-tasks.open.workspace.tasks.6243e7", "Open workspace tasks"),
            description: t("bundled.workspace-tasks.open.the.workspace.tasks.tab.configure.tasks.in.d72915", "Open the workspace tasks tab. Configure tasks in {value1}.", { value1: TASKS_CONFIG_PATH }),
            group: t("bundled.workspace-tasks.workspace.379798", "Workspace"),
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
            title: t("bundled.workspace-tasks.tasks.525304", "Tasks"),
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
            render: (context) => html`<pi-web-workspace-tasks-panel .stylesheetIntegration=${stylesheetIntegration} .context=${context}></pi-web-workspace-tasks-panel>`,
          },
        ],
      },
    };
  },
} satisfies PiWebPlugin;

export default plugin;

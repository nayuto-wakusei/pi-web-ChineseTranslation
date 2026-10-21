import { t, setTranslator } from "./i18n.js";
import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import { TASKS_CONFIG_PATH } from "./config.js";
import { defineTasksPanelElement, tasksPanelBadge } from "./tasksPanelElement.js";

const plugin: PiWebPlugin = {
  apiVersion: 4,
  name: t("bundled.workspace-tasks.workspace.tasks.b4ef49", "Workspace tasks"),
  activate: ({ runtimePluginId, html, svg, translate }) => {
    setTranslator(translate);
    defineTasksPanelElement();

    return {
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
            render: (context) => html`<pi-web-workspace-tasks-panel .context=${context}></pi-web-workspace-tasks-panel>`,
          },
        ],
      },
    };
  },
} satisfies PiWebPlugin;

export default plugin;

import type { PiWebPlugin } from "pi-web-cn/plugin-api";
import { TASKS_CONFIG_PATH } from "./config.js";
import { defineTasksPanelElement, tasksPanelBadge } from "./tasksPanelElement.js";

const plugin: PiWebPlugin = {
  apiVersion: 1,
  name: "工作区任务",
  activate: ({ pluginId, html, svg }) => {
    defineTasksPanelElement();

    return {
      contributions: {
        actions: [
          {
            id: "workspace.open-tasks",
            title: "打开工作区任务",
            description: `打开工作区任务标签页。在 ${TASKS_CONFIG_PATH} 中配置任务。`,
            group: "工作区",
            enabled: (context) => context.state.selectedWorkspace !== undefined,
            run: (context) => {
              if (context.state.selectedWorkspace === undefined) return;
              context.selectWorkspaceTool(`${pluginId}:workspace.tasks`);
            },
          },
        ],
        workspacePanels: [
          {
            id: "workspace.tasks",
            title: "任务",
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
};

export default plugin;

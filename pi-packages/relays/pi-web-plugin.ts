import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import { RELAYS_ROOT } from "./relayDiscovery.js";
import { defineRelaysPanelElement } from "./relaysPanelElement.js";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "中继",
  activate: ({ pluginId, html, svg }) => {
    defineRelaysPanelElement();

    return {
      contributions: {
        actions: [
          {
            id: "workspace.open-relays",
            title: "打开工作区中继",
            description: `打开工作区的中继标签页。中继存放在 ${RELAYS_ROOT}。`,
            group: "工作区",
            enabled: (context) => context.state.selectedWorkspace !== undefined,
            run: (context) => {
              if (context.state.selectedWorkspace === undefined) return;
              context.selectWorkspaceTool(`${pluginId}:workspace.relays`);
            },
          },
        ],
        workspacePanels: [
          {
            id: "workspace.relays",
            title: "中继",
            icon: svg`
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 17H7A5 5 0 0 1 7 7h2"></path>
                <path d="M15 7h2a5 5 0 1 1 0 10h-2"></path>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </svg>
            `,
            order: 50,
            render: (context) => html`<pi-web-relays-panel .context=${context}></pi-web-relays-panel>`,
          },
        ],
      },
    };
  },
};

export default plugin;

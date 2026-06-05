import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";

const plugin: PiWebPlugin = {
  apiVersion: 1,
  name: "信息插件",
  activate: ({ html, svg }) => ({
    contributions: {
      actions: [
        {
          id: "workspace.show-path",
          title: "显示当前工作区路径",
          group: "信息",
          enabled: (context) => context.state.selectedWorkspace !== undefined,
          run: (context) => {
            const path = context.state.selectedWorkspace?.path ?? "未选择工作区";
            window.alert(path);
          },
        },
      ],
      workspaceLabels: [
        {
          id: "workspace.kind-label",
          order: 100,
          items: (context) => [{ type: "text", text: context.workspace.isGitRepo ? "git" : "文件夹", title: context.workspace.path }],
        },
      ],
      workspacePanels: [
        {
          id: "workspace.info",
          title: "信息",
          icon: svg`
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M12 11v5"></path>
              <path d="M12 8h.01"></path>
            </svg>
          `,
          order: 1000,
          render: (context) => html`
            <section class="toolbar"><strong>信息</strong></section>
            <section class="viewer">
              <p><strong>工作区</strong></p>
              <p class="muted">${context.workspace.label}</p>
              <p class="muted">${context.workspace.path}</p>
            </section>
          `,
        },
      ],
    },
  }),
};

export default plugin;

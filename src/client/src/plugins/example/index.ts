import { html } from "lit";
import type { PiWebPlugin } from "../types";

export const examplePlugin: PiWebPlugin = {
  apiVersion: 1,
  name: "示例插件",
  activate: () => ({
    contributions: {
      actions: [
        {
          id: "workspace.show-path",
          title: "显示当前工作区路径",
          group: "示例",
          enabled: (context) => context.state.selectedWorkspace !== undefined,
          run: (context) => {
            const path = context.state.selectedWorkspace?.path ?? "未选择工作区";
            window.alert(path);
          },
        },
      ],
      workspaceLabels: [
        {
          id: "workspace.example-label",
          order: 100,
          items: (context) => [{ type: "text", text: context.workspace.isGitRepo ? "git" : "文件夹", title: context.workspace.path }],
        },
      ],
      workspacePanels: [
        {
          id: "workspace.info",
          title: "信息",
          order: 100,
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

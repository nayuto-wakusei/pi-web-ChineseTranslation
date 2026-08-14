// Skeleton of a PI WEB plugin: metadata plus contribution definitions.
//
// Everything the bundled Info panel and action actually render lives in
// infoInternals.ts. That file is replaceable implementation detail — when
// copying this plugin as a starting point, keep this file's shape and swap
// the internals for your own.

import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import { copyDiagnostics, renderInfoPanel } from "./infoInternals.js";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "信息插件",
  activate: ({ html, svg }) => ({
    contributions: {
      actions: [
        {
          id: "copy-diagnostics",
          title: "复制 PI WEB 诊断信息",
          description: "复制此机器的版本、安装和状态详情，以便粘贴到错误报告中",
          group: "信息",
          run: (context) => copyDiagnostics(context),
        },
      ],
      workspaceLabels: [
        {
          id: "workspace.kind-label",
          order: 100,
          items: (context) => [{ type: "text", text: context.workspace.isGitRepo === true ? "Git" : "文件夹", title: context.workspace.path }],
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
          render: (context) => renderInfoPanel(html, context),
        },
      ],
    },
  }),
};

export default plugin;

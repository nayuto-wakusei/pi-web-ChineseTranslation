// Skeleton of a PI WEB plugin: metadata plus contribution definitions.
//
// Everything the bundled Info panel and action actually render lives in
// infoInternals.ts. That file is replaceable implementation detail — when
// copying this plugin as a starting point, keep this file's shape and swap
// the internals for your own.

import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import { createInfoContent } from "./infoInternals.js";

const plugin = {
  apiVersion: 4,
  name: "Info Plugin",
  activate: ({ html, svg, localization }) => {
    if (localization === undefined) throw new Error("The Info plugin requires a localization-capable PI WEB host");
    const { messages, copyDiagnostics, renderInfoPanel } = createInfoContent(localization);
    return { contributions: {
      actions: [
        {
          id: "copy-diagnostics",
          get title() { return messages.t("copyDiagnostics"); },
          get description() { return messages.t("copyDescription"); },
          get group() { return messages.t("info"); },
          run: (context) => copyDiagnostics(context),
        },
      ],
      workspaceLabels: [
        {
          id: "workspace.kind-label",
          order: 100,
          items: (context) => [{ type: "text", text: context.workspace.provider?.pluginId ?? messages.t("folder"), title: context.workspace.path }],
        },
      ],
      applicationPanels: [
        {
          id: "workspace.info",
          get title() { return messages.t("info"); },
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
    } };
  },
} satisfies PiWebPlugin;

export default plugin;

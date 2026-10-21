import { t, setTranslator } from "./i18n.js";
// Skeleton of a PI WEB plugin: metadata plus contribution definitions.
//
// Everything the bundled Info panel and action actually render lives in
// infoInternals.ts. That file is replaceable implementation detail — when
// copying this plugin as a starting point, keep this file's shape and swap
// the internals for your own.

import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import { copyDiagnostics, renderInfoPanel } from "./infoInternals.js";

const plugin: PiWebPlugin = {
  apiVersion: 1,
  get name() { return t("bundled.info.info.plugin.b6e61e", "Info plugin"); },
  activate: ({ html, svg, translate }) => {
    setTranslator(translate);
    return {
    contributions: {
      actions: [
        {
          id: "copy-diagnostics",
          title: t("bundled.info.copy.pi.web.diagnostics.250f13", "Copy PI WEB diagnostics"),
          description: t("bundled.info.copy.this.machine.s.version.installation.and.status.details.for.a.c01908", "Copy this machine's version, installation, and status details for a bug report"),
          group: t("bundled.info.info.e70286", "Info"),
          run: (context) => copyDiagnostics(context),
        },
      ],
      workspaceLabels: [
        {
          id: "workspace.kind-label",
          order: 100,
          items: (context) => [{ type: "text", text: context.workspace.isGitRepo ? "Git" : t("bundled.info.folder.7c7802", "Folder"), title: context.workspace.path }],
        },
      ],
      workspacePanels: [
        {
          id: "workspace.info",
          title: t("bundled.info.info.e70286", "Info"),
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
    };
  },
};

export default plugin;

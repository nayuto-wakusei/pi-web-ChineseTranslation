import type { PiWebPlugin, PluginActivationContext, PluginActivationResult, PluginRuntimeContext } from "@chainingintention/pi-web-cn/plugin-api";

/**
 * Browser entry for the bundled Files panel.
 *
 * File HTTP stays in core. This package renders the existing Chinese
 * `<workspace-files-panel>`, which already calls the host file explorer for
 * create, move, delete, download, and upload. Do not add a server plugin.
 */
export const FILES_PLUGIN_ID = "files";
export const FILES_PANEL_ID = "workspace.files";
export const FILES_PANEL_ROUTE_ALIASES = ["files", "core:workspace.files"] as const;

const plugin = {
  apiVersion: 4,
  name: "文件",
  activate: (context) => activateFilesPlugin(context),
} satisfies PiWebPlugin;

export default plugin;

export function activateFilesPlugin(context: PluginActivationContext): PluginActivationResult {
  if (context.pluginId !== FILES_PLUGIN_ID) {
    throw new Error(`Files browser entry must activate as plugin id ${FILES_PLUGIN_ID}, received ${context.pluginId}`);
  }
  const panelId = `${context.runtimePluginId}:${FILES_PANEL_ID}`;
  return {
    contributions: {
      workspacePanels: [{
        id: FILES_PANEL_ID,
        title: "文件",
        icon: context.svg`
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"></path>
          </svg>
        `,
        order: 10,
        routeAliases: [...FILES_PANEL_ROUTE_ALIASES],
        navigationAliases: ["core:workspace.files"],
        fileOpenQuery: (_context, path) => ({ file: path }),
        render: () => context.html`<workspace-files-panel></workspace-files-panel>`,
      }],
      actions: [
        {
          id: "view.files",
          title: "转到文件",
          shortcut: "mod+2",
          shortcutAliases: ["core:view.files"],
          group: "导航",
          enabled: (runtimeContext: PluginRuntimeContext) => runtimeContext.state.selectedWorkspace !== undefined,
          run: (runtimeContext: PluginRuntimeContext) => { runtimeContext.selectWorkspaceTool(panelId); },
        },
        {
          id: "workspace.refresh-files",
          title: "刷新文件",
          shortcut: "mod+shift+f",
          shortcutAliases: ["core:workspace.refresh-files"],
          group: "工作区",
          enabled: (runtimeContext: PluginRuntimeContext) => runtimeContext.state.selectedWorkspace !== undefined,
          run: (runtimeContext: PluginRuntimeContext) => { void runtimeContext.refreshFiles(); },
        },
      ],
    },
  };
}

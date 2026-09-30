import type { PiWebPlugin, PluginActivationContext, PluginActivationResult, PluginRuntimeContext } from "@chainingintention/pi-web-cn/plugin-api";

/**
 * Browser entry for the bundled terminal panel.
 *
 * Server ownership stays in core until a later cutover. sessiond still constructs
 * TerminalService and registers `/terminals`, because management-embed Bubblewrap
 * sandboxing and the Windows shell fallback live there. This package has no
 * server plugin and must not take over PTY ownership.
 *
 * The panel renders the host `<pi-web-terminal-host>` element. The host fills
 * that tag with the existing Chinese `<terminal-panel>`, which already uses
 * terminalsApi and the terminal socket. Do not add a plugin peer channel here.
 */
export const TERMINAL_PLUGIN_ID = "pi-web.terminal";
export const TERMINAL_PANEL_ID = "workspace.terminal";
export const TERMINAL_PANEL_ROUTE_ALIASES = ["terminal", "core:workspace.terminal"] as const;

const plugin = {
  apiVersion: 4,
  name: "终端",
  activate: (context) => activateTerminalPlugin(context),
} satisfies PiWebPlugin;

export default plugin;

export function activateTerminalPlugin(context: PluginActivationContext): PluginActivationResult {
  if (context.pluginId !== TERMINAL_PLUGIN_ID) {
    throw new Error(`Terminal browser entry must activate as plugin id ${TERMINAL_PLUGIN_ID}, received ${context.pluginId}`);
  }
  if (isManagementEmbedMode()) return { contributions: {} };
  const panelId = `${context.runtimePluginId ?? context.pluginId}:${TERMINAL_PANEL_ID}`;
  return {
    contributions: {
      workspacePanels: [{
        id: TERMINAL_PANEL_ID,
        title: "终端",
        icon: context.svg`
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <rect x="3" y="4" width="18" height="16" rx="2"></rect>
            <path d="m7 9 3 3-3 3M13 15h4"></path>
          </svg>
        `,
        order: 30,
        routeAliases: [...TERMINAL_PANEL_ROUTE_ALIASES],
        navigationAliases: ["core:workspace.terminal"],
        badge: (workspaceContext) => terminalBadgeCount(workspaceContext),
        render: () => context.html`<pi-web-terminal-host></pi-web-terminal-host>`,
      }],
      actions: [{
        id: "view.terminal",
        title: "转到终端",
        shortcut: "mod+4",
        shortcutAliases: ["core:view.terminal"],
        group: "导航",
        enabled: (runtimeContext: PluginRuntimeContext) => runtimeContext.state.selectedWorkspace !== undefined,
        run: (runtimeContext: PluginRuntimeContext) => { runtimeContext.selectWorkspaceTool(panelId); },
      }],
    },
  };
}

function terminalBadgeCount(context: object): number | undefined {
  const count: unknown = Reflect.get(context, "activeTerminalCount");
  return typeof count === "number" && count > 0 ? count : undefined;
}

function isManagementEmbedMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("embed")?.trim() === "management";
}

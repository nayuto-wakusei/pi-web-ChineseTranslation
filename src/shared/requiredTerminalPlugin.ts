export const REQUIRED_TERMINAL_PLUGIN_ID = "pi-web.terminal";

/** Qualified ids the bundled terminal panel still accepts from older URLs and shortcuts. */
export const REQUIRED_TERMINAL_PANEL_ID = "workspace.terminal";
export const REQUIRED_TERMINAL_LEGACY_PANEL_ID = "core:workspace.terminal";
export const REQUIRED_TERMINAL_ROUTE_ALIASES = ["terminal", REQUIRED_TERMINAL_LEGACY_PANEL_ID] as const;

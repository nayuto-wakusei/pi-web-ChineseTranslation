export const REQUIRED_TERMINAL_PLUGIN_ID = "pi-web.terminal";

export type TerminalPluginMode = "required" | "recovery-disabled";

export function terminalPluginModeForSafeStart(safeStart: "bundled-only" | "none" | undefined): TerminalPluginMode {
  return safeStart === "none" ? "recovery-disabled" : "required";
}

export const REQUIRED_TERMINAL_RECOVERY_GUIDANCE = "使用 `pi-web plugins safe-start set none --restart`，以不启用终端的恢复模式启动 PI WEB。";

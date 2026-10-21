import type { Translator } from "../../shared/i18n.js";
import type { ClientCommand } from "../types.js";

export const BUILTIN_COMMANDS: ClientCommand[] = [
  { name: "settings", description: "Open settings menu", source: "builtin" },
  { name: "model", description: "Select model", source: "builtin" },
  { name: "scoped-models", description: "Enable or disable models for cycling", source: "builtin" },
  { name: "export", description: "Export session", source: "builtin" },
  { name: "import", description: "Import and resume a JSONL session", source: "builtin" },
  { name: "share", description: "Share session as a private GitHub gist", source: "builtin" },
  { name: "copy", description: "Copy the last agent message", source: "builtin" },
  { name: "name", description: "Set session display name", source: "builtin" },
  { name: "session", description: "Show session information and statistics", source: "builtin" },
  { name: "changelog", description: "Show changelog entries", source: "builtin" },
  { name: "hotkeys", description: "Show keyboard shortcuts", source: "builtin" },
  { name: "fork", description: "Fork from an earlier user message", source: "builtin" },
  { name: "clone", description: "Clone the current session at this point", source: "builtin" },
  { name: "tree", description: "Navigate the session tree", source: "builtin" },
  { name: "login", description: "Configure provider authentication", source: "builtin" },
  { name: "logout", description: "Remove provider authentication", source: "builtin" },
  { name: "new", description: "Start a new session", source: "builtin" },
  { name: "compact", description: "Compact session context manually", source: "builtin" },
  { name: "resume", description: "Resume another session", source: "builtin" },
  { name: "reload", description: "Reload Pi runtime resources for the current session", source: "builtin" },
  { name: "quit", description: "Quit pi", source: "builtin" },
];

export function isBuiltinCommand(name: string): boolean {
  return BUILTIN_COMMANDS.some((command) => command.name === name);
}

export function builtinCommands(t: Translator): ClientCommand[] {
  return BUILTIN_COMMANDS.map((command) => ({ ...command, description: t(`builtin.${command.name}`, command.description ?? "") }));
}

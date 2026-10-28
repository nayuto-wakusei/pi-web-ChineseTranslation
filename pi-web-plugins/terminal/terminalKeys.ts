export type TerminalSoftKeyId =
  | "escape"
  | "tab"
  | "ctrl-c"
  | "ctrl-d"
  | "ctrl-z"
  | "ctrl-l"
  | "ctrl-r"
  | "ctrl-u"
  | "ctrl-w"
  | "arrow-left"
  | "arrow-up"
  | "arrow-down"
  | "arrow-right"
  | "home"
  | "end"
  | "page-up"
  | "page-down"
  | "delete"
  | "backspace"
  | "meta-backward-word"
  | "meta-forward-word";

export interface TerminalModesSnapshot {
  applicationCursorKeysMode: boolean;
}

export interface TerminalSoftKeyDefinition {
  id: TerminalSoftKeyId;
  label: string;
}

// Keycap legends identify literal keyboard keys, not translated instructions.
// Accessible names and explanatory tooltips live in terminal.messages.ts.
export const TERMINAL_SOFT_KEYS: readonly TerminalSoftKeyDefinition[] = [
  { id: "escape", label: "Esc" },
  { id: "tab", label: "Tab" },
  { id: "ctrl-c", label: "Ctrl+C" },
  { id: "ctrl-d", label: "Ctrl+D" },
  { id: "ctrl-z", label: "Ctrl+Z" },
  { id: "ctrl-l", label: "Ctrl+L" },
  { id: "ctrl-r", label: "Ctrl+R" },
  { id: "ctrl-u", label: "Ctrl+U" },
  { id: "ctrl-w", label: "Ctrl+W" },
  { id: "arrow-left", label: "←" },
  { id: "arrow-up", label: "↑" },
  { id: "arrow-down", label: "↓" },
  { id: "arrow-right", label: "→" },
  { id: "home", label: "Home" },
  { id: "end", label: "End" },
  { id: "page-up", label: "PgUp" },
  { id: "page-down", label: "PgDn" },
  { id: "delete", label: "Del" },
  { id: "backspace", label: "⌫" },
  { id: "meta-backward-word", label: "M-B" },
  { id: "meta-forward-word", label: "M-F" },
];

const ESC = "\x1b";
const DEL = "\x7f";

export function terminalSoftKeySequence(key: TerminalSoftKeyId, modes?: TerminalModesSnapshot): string {
  switch (key) {
    case "escape": return ESC;
    case "tab": return "\t";
    case "ctrl-c": return controlSequence("c");
    case "ctrl-d": return controlSequence("d");
    case "ctrl-z": return controlSequence("z");
    case "ctrl-l": return controlSequence("l");
    case "ctrl-r": return controlSequence("r");
    case "ctrl-u": return controlSequence("u");
    case "ctrl-w": return controlSequence("w");
    case "arrow-left": return cursorSequence("D", modes);
    case "arrow-up": return cursorSequence("A", modes);
    case "arrow-down": return cursorSequence("B", modes);
    case "arrow-right": return cursorSequence("C", modes);
    case "home": return cursorEndpointSequence("H", modes);
    case "end": return cursorEndpointSequence("F", modes);
    case "page-up": return `${ESC}[5~`;
    case "page-down": return `${ESC}[6~`;
    case "delete": return `${ESC}[3~`;
    case "backspace": return DEL;
    case "meta-backward-word": return `${ESC}b`;
    case "meta-forward-word": return `${ESC}f`;
  }
}

function controlSequence(letter: string): string {
  return String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64);
}

function cursorSequence(code: "A" | "B" | "C" | "D", modes: TerminalModesSnapshot | undefined): string {
  return modes?.applicationCursorKeysMode === true ? `${ESC}O${code}` : `${ESC}[${code}`;
}

function cursorEndpointSequence(code: "F" | "H", modes: TerminalModesSnapshot | undefined): string {
  return modes?.applicationCursorKeysMode === true ? `${ESC}O${code}` : `${ESC}[${code}`;
}

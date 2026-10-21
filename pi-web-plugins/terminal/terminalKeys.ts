import { t } from "./i18n.js";
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
  ariaLabel: string;
  title: string;
}

export const TERMINAL_SOFT_KEYS: readonly TerminalSoftKeyDefinition[] = [
  { id: "escape", label: "Esc", ariaLabel: t("client.terminalKeys.escape.key.78695d", "Escape key"), title: t("client.terminalKeys.send.escape.a69d7f", "Send Escape") },
  { id: "tab", label: "Tab", ariaLabel: t("client.terminalKeys.tab.key.5b5875", "Tab key"), title: t("client.terminalKeys.send.tab.b37b74", "Send Tab") },
  { id: "ctrl-c", label: "Ctrl+C", ariaLabel: "Ctrl+C", title: t("client.terminalKeys.interrupt.foreground.process.171a44", "Interrupt foreground process") },
  { id: "ctrl-d", label: "Ctrl+D", ariaLabel: "Ctrl+D", title: t("client.terminalKeys.send.eof.close.input.9b905d", "Send EOF / close input") },
  { id: "ctrl-z", label: "Ctrl+Z", ariaLabel: "Ctrl+Z", title: t("client.terminalKeys.suspend.foreground.process.a0aaa2", "Suspend foreground process") },
  { id: "ctrl-l", label: "Ctrl+L", ariaLabel: "Ctrl+L", title: t("client.terminalKeys.clear.redraw.terminal.ef70df", "Clear / redraw terminal") },
  { id: "ctrl-r", label: "Ctrl+R", ariaLabel: "Ctrl+R", title: t("client.terminalKeys.reverse.history.search.9baa58", "Reverse history search") },
  { id: "ctrl-u", label: "Ctrl+U", ariaLabel: "Ctrl+U", title: t("client.terminalKeys.delete.to.start.of.line.c2bd72", "Delete to start of line") },
  { id: "ctrl-w", label: "Ctrl+W", ariaLabel: "Ctrl+W", title: t("client.terminalKeys.delete.previous.word.582578", "Delete previous word") },
  { id: "arrow-left", label: "←", ariaLabel: t("client.terminalKeys.left.arrow.1978cf", "Left arrow"), title: t("client.terminalKeys.move.left.1db768", "Move left") },
  { id: "arrow-up", label: "↑", ariaLabel: t("client.terminalKeys.up.arrow.7663cd", "Up arrow"), title: t("client.terminalKeys.move.up.previous.command.326744", "Move up / previous command") },
  { id: "arrow-down", label: "↓", ariaLabel: t("client.terminalKeys.down.arrow.07c01f", "Down arrow"), title: t("client.terminalKeys.move.down.next.command.1a2b07", "Move down / next command") },
  { id: "arrow-right", label: "→", ariaLabel: t("client.terminalKeys.right.arrow.e0ed6e", "Right arrow"), title: t("client.terminalKeys.move.right.5ac956", "Move right") },
  { id: "home", label: "Home", ariaLabel: t("client.terminalKeys.home.key.0c1b1d", "Home key"), title: t("client.terminalKeys.move.to.start.162d77", "Move to start") },
  { id: "end", label: "End", ariaLabel: t("client.terminalKeys.end.key.aa23a6", "End key"), title: t("client.terminalKeys.move.to.end.ef9a38", "Move to end") },
  { id: "page-up", label: "PgUp", ariaLabel: t("client.terminalKeys.page.up.d918c1", "Page up"), title: t("client.terminalKeys.page.up.d918c1", "Page up") },
  { id: "page-down", label: "PgDn", ariaLabel: t("client.terminalKeys.page.down.f03168", "Page down"), title: t("client.terminalKeys.page.down.f03168", "Page down") },
  { id: "delete", label: "Del", ariaLabel: t("client.terminalKeys.delete.key.1649bc", "Delete key"), title: t("client.terminalKeys.delete.forward.ada4b7", "Delete forward") },
  { id: "backspace", label: "⌫", ariaLabel: t("client.terminalKeys.backspace.key.e79e22", "Backspace key"), title: t("client.terminalKeys.backspace.d5407b", "Backspace") },
  { id: "meta-backward-word", label: "M-B", ariaLabel: "Meta+B", title: t("client.terminalKeys.move.backward.one.word.99de53", "Move backward one word") },
  { id: "meta-forward-word", label: "M-F", ariaLabel: "Meta+F", title: t("client.terminalKeys.move.forward.one.word.f92250", "Move forward one word") },
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

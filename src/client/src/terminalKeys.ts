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
  { id: "escape", label: "Esc", ariaLabel: "Escape 键", title: "发送 Escape" },
  { id: "tab", label: "Tab", ariaLabel: "Tab 键", title: "发送 Tab" },
  { id: "ctrl-c", label: "Ctrl+C", ariaLabel: "Ctrl+C", title: "中断前台进程" },
  { id: "ctrl-d", label: "Ctrl+D", ariaLabel: "Ctrl+D", title: "发送 EOF / 关闭输入" },
  { id: "ctrl-z", label: "Ctrl+Z", ariaLabel: "Ctrl+Z", title: "挂起前台进程" },
  { id: "ctrl-l", label: "Ctrl+L", ariaLabel: "Ctrl+L", title: "清屏 / 重绘终端" },
  { id: "ctrl-r", label: "Ctrl+R", ariaLabel: "Ctrl+R", title: "反向搜索历史" },
  { id: "ctrl-u", label: "Ctrl+U", ariaLabel: "Ctrl+U", title: "删除到行首" },
  { id: "ctrl-w", label: "Ctrl+W", ariaLabel: "Ctrl+W", title: "删除上一个单词" },
  { id: "arrow-left", label: "←", ariaLabel: "左箭头", title: "向左移动" },
  { id: "arrow-up", label: "↑", ariaLabel: "上箭头", title: "向上移动 / 上一条命令" },
  { id: "arrow-down", label: "↓", ariaLabel: "下箭头", title: "向下移动 / 下一条命令" },
  { id: "arrow-right", label: "→", ariaLabel: "右箭头", title: "向右移动" },
  { id: "home", label: "Home", ariaLabel: "行首键", title: "移动到开头" },
  { id: "end", label: "End", ariaLabel: "行尾键", title: "移动到末尾" },
  { id: "page-up", label: "PgUp", ariaLabel: "向上翻页", title: "向上翻页" },
  { id: "page-down", label: "PgDn", ariaLabel: "向下翻页", title: "向下翻页" },
  { id: "delete", label: "Del", ariaLabel: "删除键", title: "向前删除" },
  { id: "backspace", label: "⌫", ariaLabel: "退格键", title: "退格" },
  { id: "meta-backward-word", label: "M-B", ariaLabel: "Meta+B", title: "向后移动一个单词" },
  { id: "meta-forward-word", label: "M-F", ariaLabel: "Meta+F", title: "向前移动一个单词" },
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

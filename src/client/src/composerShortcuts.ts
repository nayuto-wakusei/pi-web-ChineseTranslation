import type { AppAction } from "./actions";
import { normalizeShortcut, shortcutTokenFromEvent, type ShortcutKeyEvent, type ShortcutPreferenceConfig } from "./keyboardShortcuts";
import { readPromptEnterPreference, shouldSendPromptOnEnter, type PromptEnterMedia, type PromptEnterPreference } from "./promptEnterBehavior";

export const COMPOSER_SEND_DESKTOP = "composer.send.desktop";
export const COMPOSER_SEND_MOBILE = "composer.send.mobile";

export function isComposerShortcut(actionId: string): boolean {
  return actionId === COMPOSER_SEND_DESKTOP || actionId === COMPOSER_SEND_MOBILE;
}

/** Settings-only descriptors. The focused editor owns actual submission. */
export function composerShortcutActions(preference = readPromptEnterPreference()): AppAction[] {
  return [false, true].map((mobile) => ({
    id: mobile ? COMPOSER_SEND_MOBILE : COMPOSER_SEND_DESKTOP,
    title: mobile ? "发送消息 — 触屏或窄屏" : "发送消息 — 桌面",
    description: "仅在消息编辑器内生效的单个组合键。编辑器内优先于全局快捷键。",
    group: "聊天输入框",
    shortcut: defaultSendShortcut({ matches: mobile }, preference),
    run: () => undefined,
  }));
}

export function composerSendShortcut(shortcuts: ShortcutPreferenceConfig, media?: PromptEnterMedia, preference = readPromptEnterPreference()): string | null {
  const id = media?.matches === true ? COMPOSER_SEND_MOBILE : COMPOSER_SEND_DESKTOP;
  return shortcuts[id] === undefined ? defaultSendShortcut(media, preference) : shortcuts[id];
}

export function matchesComposerSend(event: ShortcutKeyEvent, shortcut: string | null): boolean {
  if (shortcut === null) return false;
  const tokens = normalizeShortcut(shortcut);
  return tokens.length === 1 && tokens[0] === shortcutTokenFromEvent(event);
}

function defaultSendShortcut(media: PromptEnterMedia | undefined, preference: PromptEnterPreference): string {
  return shouldSendPromptOnEnter(media, preference) ? "enter" : "shift+enter";
}

import { t } from "./i18n";
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
    title: mobile ? t("ui.main.1ad9b8f6af70", "narrow screen") : t("ui.main.a6a82014e150", "desktop"),
    description: t("ui.main.9fffd0fc011d", "One key combination, active only in the message editor. Overrides global shortcuts there."),
    group: t("ui.settingsShortcutsPanel.chatInput", "Chat input"),
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

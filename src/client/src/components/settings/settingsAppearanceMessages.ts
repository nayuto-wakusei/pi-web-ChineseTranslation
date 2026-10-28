import { localization } from "../../localization/browser";
import theme from "./settingsTheme.messages";
import shortcuts from "./settingsShortcuts.messages";
import frame from "./settingsFrame.messages";

export const frameMessages = localization.registerMessages("core.settingsFrame", frame);
export const themeMessages = localization.registerMessages("core.settingsTheme", theme);
export const shortcutMessages = localization.registerMessages("core.settingsShortcuts", shortcuts);

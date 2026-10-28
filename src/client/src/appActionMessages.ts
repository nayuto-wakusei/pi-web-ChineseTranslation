import { localization } from "./localization/browser";
import definitions from "./components/appActions.messages";

export const appActionMessages = localization.registerMessages("core.appActions", definitions);

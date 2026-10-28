import { localization } from "./localization/browser";
import definitions from "./components/auth.messages";

export const authMessages = localization.registerMessages("core.auth", definitions);

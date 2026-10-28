import { localization } from "../../localization/browser";
import actions from "./actions.messages";
import messageActions from "./messageActions.messages";

export const coreActionMessages = localization.registerMessages("core.actions", actions);
export const coreMessageActionMessages = localization.registerMessages("core.messageActions", messageActions);

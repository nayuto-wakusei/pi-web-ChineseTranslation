import { message } from "../../../shared/localization";

export default {
  stale: message("Chat may be out of date.", "Conversation notice when messages may need refreshing"),
  interrupted: message("Could not refresh messages.", "Conversation notice when a refresh request failed"),
  retry: message("Refresh messages", "Request a fresh conversation snapshot"),
};

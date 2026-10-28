import { message } from "../../localization/service";

export default {
  fork: message("Clone session from this message", "Message history action title"),
  confirmFork: message("Are you sure you want to fork this session?", "Native confirmation before cloning session history"),
  back: message("Go back to this message", "Message history rewind action title"),
  copy: message("Copy message", "Copy original message text to the clipboard"),
  copyRole: message<{ role: string }>("{role, select, user {Copy user message} assistant {Copy assistant message} other {Copy message}}", "Copy action accessible name, including message role"),
  copied: message("Copied", "Temporary successful clipboard feedback"),
  copiedRole: message<{ role: string }>("{role, select, user {Copied user message} assistant {Copied assistant message} other {Copied message}}", "Successful clipboard feedback accessible name"),
  copyFailed: message("Unable to copy message to the clipboard.", "Clipboard helper reported failure; not a backend diagnostic"),
};

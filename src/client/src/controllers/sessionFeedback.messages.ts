import { message } from "../../../shared/localization";

export default {
  archiveFailure: message<{ detail: string }>("Archive failed: {detail}", "Bulk archive request failed; detail is an untranslated runtime diagnostic"),
  deleteFailure: message<{ detail: string }>("Delete failed: {detail}", "Bulk delete request failed; detail is an untranslated runtime diagnostic"),
  archivePartialFailure: message<{ count: number; details: string }>("Archive failed for {count, plural, one {# session} other {# sessions}}: {details}", "Bulk archive partial failures; details contain raw session identifiers and runtime diagnostics"),
  deletePartialFailure: message<{ count: number; details: string }>("Delete failed for {count, plural, one {# session} other {# sessions}}: {details}", "Bulk delete partial failures; details contain raw session identifiers and runtime diagnostics"),
  sessionListRefresh: message("The session list could not be refreshed. Check your connection and retry.", "Workspace session-list network recovery exhausted"),
  conversationRefresh: message("The conversation could not be refreshed. Check your connection and retry.", "Selected conversation network recovery exhausted"),
};

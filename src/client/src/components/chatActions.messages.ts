import { message } from "../localization/service";

export default {
  recall: message<{ attachments: string; steers: number; followUps: number }>(
    "{attachments, select, yes {Recall this message? Only its text will return to the composer. Its attachments will be lost.} other {Recall this message?}}"
    + "{steers, plural, =0 {{followUps, plural, =0 {} one {\n\nThis will also remove # queued follow-up.} other {\n\nThis will also remove # queued follow-ups.}}} one {{followUps, plural, =0 {\n\nThis will also remove {steers, number} later steer.} one {\n\nThis will also remove {steers, number} later steer and # queued follow-up.} other {\n\nThis will also remove {steers, number} later steer and # queued follow-ups.}}} other {{followUps, plural, =0 {\n\nThis will also remove {steers, number} later steers.} one {\n\nThis will also remove {steers, number} later steers and # queued follow-up.} other {\n\nThis will also remove {steers, number} later steers and # queued follow-ups.}}}}",
    "Native confirmation before recalling queued text. Attachments are lost and every later queued message is removed; steers and followUps are separate counts. Zero of both means only the attachment warning is needed.",
  ),
  recallDraft: message("Recalling will replace your unsent draft. Continue?", "Second native recall confirmation when the composer contains unsent text"),
  backDraft: message("Going back will replace your unsent draft. Continue?", "Native confirmation before history navigation replaces the live composer draft"),
  conversationUnavailable: message("This message's conversation is no longer available.", "History action rejected because selection changed or the plugin owner is unavailable"),
  draftActionPending: message("Another draft-replacing action is already in progress.", "History action rejected while another recall or history replacement is pending"),
  historyUnavailable: message("Session history is unavailable.", "Fallback when the runtime returns neither a history tree nor its own diagnostic"),
  messageUnavailable: message("This message is no longer available in session history.", "History action target is absent from the authoritative session tree"),
  treeUnavailable: message("The session tree navigator is no longer available", "Navigation or fork rejected because its session or tree is no longer available"),
};

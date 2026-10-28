import { message } from "../../../shared/localization";

export default {
  newSession: message("New session", "Temporary session row name before backend creation completes"),
  creating: message("Creating session", "Pending session startup activity label"),
  waiting: message("Waiting for the backend session to be ready", "Pending session startup detail without queued sends"),
  queued: message<{ count: number }>("{count, plural, one {# queued message will send when the backend session is ready} other {# queued messages will send when the backend session is ready}}", "Startup detail showing locally retained sends"),
  failed: message("Session creation failed", "Failed pending session activity label"),
  failedDetail: message<{ detail: string; count: number }>("{count, plural, =0 {{detail}} one {{detail} · # queued message kept below} other {{detail} · # queued messages kept below}}", "Failed startup detail; detail is an untranslated runtime diagnostic"),
  startFailure: message<{ detail: string }>("Failed to start session: {detail}", "Startup failure banner; detail is an untranslated diagnostic"),
  queueUnavailable: message("The backend session is not ready for queued sends. Copy your message before discarding this failed start.", "Recovery guidance when sending to a failed temporary session"),
  commandInput: message<{ command: string }>("Queued command “{command}” needs input; open the session and run it again.", "Queued command needs an interactive response; command is raw user input"),
  navigationChanged: message("Session started, but its navigation changed before selection completed. Select it from the session list.", "Started session could not be selected because navigation changed"),
  selectionChanged: message("Session started, but its selection changed before navigation completed. Select it from the session list.", "Started session selection changed during navigation"),
  selectionFailure: message<{ detail: string }>("Session started, but it could not be selected: {detail}", "Started session navigation failed; detail is an untranslated diagnostic"),
  attachments: message<{ count: number }>("[{count, plural, one {# attachment queued} other {# attachments queued}}]", "Queued attachment preview without filenames"),
  namedAttachments: message<{ count: number; names: string; remaining: number }>("[{count, plural, one {# attachment queued} other {# attachments queued}}: {names}{remaining, plural, =0 {} other {, +# more}}]", "Queued attachment preview; names are raw filenames, at most three, remaining counts omitted filenames"),
  promptAttachments: message<{ text: string; attachments: string }>("{text}\n\n{attachments}", "Queued prompt preview with attachment summary; text is raw user content"),
};

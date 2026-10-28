import { message } from "./localization/service";

type Named = Record<"hasValue" | "value", string>;
type WithContent = Record<"hasName" | "name" | "hasContent" | "content", string>;

export default {
  image: message("[image]", "Image placeholder in a history preview, not a marker parsed from user text"),
  message: message("Message", "History preview when a message role is unavailable"),
  "user-message": message("User message", "History preview for an empty user message"),
  "assistant-response": message("Assistant response", "History preview for an empty assistant response"),
  "assistant-error": message("Assistant error", "History preview for an assistant response that failed"),
  "assistant-aborted": message("Assistant response aborted", "History preview for an aborted assistant response"),
  "hidden-custom-message": message("Hidden custom message", "History preview for a hidden extension message; its content is never sent to the browser"),
  "compaction-summary": message("Compaction summary", "History preview when the compaction summary is empty"),
  "branch-summary": message("Branch summary", "History preview when the branch summary is empty"),
  shell: message<Named>("{hasValue, select, yes {Shell: {value}} other {Shell command}}", "History shell command preview; value is an untranslated command"),
  model: message<Named>("{hasValue, select, yes {Model: {value}} other {Model changed}}", "History model change; value is an untranslated provider/model identifier"),
  "thinking-level": message<Named>("{hasValue, select, yes {Thinking level: {value}} other {Thinking level changed}}", "History thinking change; value is the stored level identifier"),
  "session-name": message<Named>("{hasValue, select, yes {Session name: {value}} other {Session info changed}}", "History name change; value is an untranslated user name"),
  label: message<Named>("{hasValue, select, yes {Label: {value}} other {Label removed}}", "History label change; value is an untranslated user label"),
  "custom-entry": message<Named>("{hasValue, select, yes {Custom entry: {value}} other {Custom entry}}", "History extension entry; value is an untranslated extension type identifier"),
  entry: message<Named>("{hasValue, select, yes {Entry: {value}} other {Other session entry}}", "History unknown entry; value is an untranslated SDK entry type"),
  toolCalls: message<{ names: string }>("Tool call: {names}", "History assistant tool calls; names is a locale-formatted list of untranslated tool identifiers"),
  toolResult: message<WithContent & { error: string }>("{error, select, yes {Tool error} other {Tool result}}{hasName, select, yes { ({name})} other {}}{hasContent, select, yes {: {content}} other {}}", "Complete history tool result preview. Name is a raw tool identifier; content contains raw text and localized image placeholders. Both may be absent."),
  customMessage: message<WithContent>("Custom message{hasName, select, yes { ({name})} other {}}{hasContent, select, yes {: {content}} other {}}", "Complete visible extension message preview. Name is a raw custom type; content contains raw text and localized image placeholders. Both may be absent."),
};

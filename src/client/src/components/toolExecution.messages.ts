import { message } from "../localization/service";

export default {
  status: message<{ status: string }>("{status, select, success {done} error {failed} running {running} other {pending}}", "Tool execution status; status is success, error, running or pending"),
  targetLabel: message<{ kind: string }>("{kind, select, file {File} command {Command} other {Input}}", "Expanded tool target field label; kind is file, command or input"),
  targetDescription: message<{ kind: string; text: string }>("{kind, select, file {File: {text}} command {Command: {text}} other {Input: {text}}}", "Accessible tool target description; preserve raw path, command or input text"),
  edits: message<{ count: number }>("{count, plural, one {# edit} other {# edits}}", "Number of edit operations in a tool call"),
  mismatch: message("Applied diff differs from the preview.", "Notice when the applied tool diff differs from its proposed preview"),
  details: message("Details", "Expand tool command/input and result text"),
  result: message("Result", "Label of raw tool result text"),
  previewComputed: message("Edit preview computed.", "Transient PI WEB edit-tool progress notice when no diff preview is available; raw tool diagnostics are separate"),
  previewDiff: message("Preview diff", "Proposed diff disclosure and accessible name"),
  appliedDiff: message("Applied diff", "Applied diff disclosure and accessible name"),
  lines: message<{ count: number }>("{count, plural, one {# line} other {# lines}}", "Total number of lines in a tool diff"),
  showing: message<{ visible: number; total: number }>("Showing {visible, number} of {total, number} lines", "Truncated tool diff preview line count"),
  fullDiff: message("Full diff", "Diff toolbar status when every line is shown"),
  copied: message("Copied", "Confirmation that the full raw tool diff was copied"),
  copyDiff: message("Copy diff", "Copy the full raw tool diff including collapsed lines"),
  showAll: message<{ count: number }>("Show all {count, number} diff lines", "Expand the truncated tool diff"),
};

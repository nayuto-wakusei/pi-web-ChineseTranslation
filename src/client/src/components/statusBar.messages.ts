import { message } from "../localization/service";

export default {
  empty: message("No session status yet", "Status bar before session statistics arrive"),
  contextSize: message<{ size: string }>("context {size}", "Status bar context window size when usage is unavailable; size is a regionally formatted token count"),
  contextUsage: message<{ percent: string; size: string }>("{percent}/{size}", "Compact context usage and window size; percent includes its localized percent sign, size is a formatted token count"),
  contextUnknown: message("context unknown", "Status bar when the context window size is unavailable"),
  queued: message<{ count: number }>("{count, plural, one {# queued} other {# queued}}", "Pending session message count in the compact status bar"),
  minimizeWarnings: message<{ count: number }>("{count, plural, one {Minimise # warning} other {Minimise # warnings}}", "Warning toggle accessible label and tooltip when expanded"),
  showWarnings: message<{ count: number }>("{count, plural, one {Show # warning in the warning area} other {Show # warnings in the warning area}}", "Warning toggle accessible label and tooltip when collapsed"),
};

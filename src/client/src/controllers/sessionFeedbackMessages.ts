import { localization } from "../localization/browser";
import definitions from "./sessionFeedback.messages";

export const sessionFeedbackMessages = localization.registerMessages("core.sessionFeedback", definitions);

/** Only browser-authored wrappers opt in; runtime errors remain untranslated. */
export class SessionFeedbackError extends Error {
  constructor(private readonly displayMessage: () => string) { super(); }
  override get message(): string { return this.displayMessage(); }
  override toString(): string { return this.message; }
}

import { localization } from "../localization/browser";
import definitions from "./pendingSession.messages";

export const pendingSessionMessages = localization.registerMessages("core.pendingSession", definitions);

/** Browser-owned guidance retains its formatter; runtime diagnostics remain values. */
export class PendingSessionError extends Error {
  constructor(private readonly displayMessage: () => string) { super(); }
  override get message(): string { return this.displayMessage(); }
  override toString(): string { return this.message; }
}

import type { BrowserErrorReporter, BrowserErrorScope } from "../browserErrors";
import { localization } from "../localization/browser";
import definitions from "./projectWorkspace.messages";

export const projectWorkspaceMessages = localization.registerMessages("core.projectWorkspaceFeedback", definitions);

/** Provenance for browser-owned failures; provider diagnostics never opt in by text. */
export class ProjectWorkspaceError extends Error {
  constructor(private readonly displayMessage: () => string) { super(); }
  override get message(): string { return this.displayMessage(); }
}

export function reportProjectWorkspaceError(reporter: BrowserErrorReporter, scope: BrowserErrorScope, error: unknown): void {
  if (error instanceof ProjectWorkspaceError) reporter.reportLocalized(scope, () => String(error));
  else reporter.report(scope, String(error));
}

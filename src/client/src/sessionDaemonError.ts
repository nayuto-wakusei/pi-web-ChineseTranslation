import { t } from "./i18n";
import { HttpRequestError } from "./api/http";

const SESSION_DAEMON_TIMEOUT_TEXT = /timed out|operation was aborted|request cancelled/i;

export function isTransientSessionDaemonRequestError(error: unknown): boolean {
  if (error instanceof HttpRequestError && (error.status === 504 || error.status === 499)) return true;
  return error instanceof Error && SESSION_DAEMON_TIMEOUT_TEXT.test(error.message);
}

export function sessionDaemonErrorText(error: unknown): string {
  if (isTransientSessionDaemonRequestError(error)) {
    return t("ui.main.634a1618e706", "The session daemon request timed out. The conversation is still running.");
  }
  return error instanceof Error ? error.message : String(error);
}

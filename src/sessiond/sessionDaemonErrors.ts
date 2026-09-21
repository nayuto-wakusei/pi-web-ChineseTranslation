export const SESSION_DAEMON_REQUEST_TIMEOUT_MESSAGE = "session daemon request timed out";
export const SESSION_DAEMON_REQUEST_CANCELLED_MESSAGE = "HTTP request cancelled";

export function normalizeSessionDaemonRequestError(error: unknown, signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  if (isSessionDaemonCancelledError(reason) || isSessionDaemonCancelledError(error)) {
    return reason instanceof Error && reason.message === SESSION_DAEMON_REQUEST_CANCELLED_MESSAGE
      ? reason
      : new Error(SESSION_DAEMON_REQUEST_CANCELLED_MESSAGE, { cause: error instanceof Error ? error : undefined });
  }
  if (reason instanceof Error && reason.message === SESSION_DAEMON_REQUEST_TIMEOUT_MESSAGE) return reason;
  if (isSessionDaemonTimeoutError(reason) || isSessionDaemonTimeoutError(error)) {
    return new Error(SESSION_DAEMON_REQUEST_TIMEOUT_MESSAGE, { cause: error instanceof Error ? error : undefined });
  }
  if (reason instanceof Error) return reason;
  return error instanceof Error ? error : new Error(String(error));
}

export function sessionDaemonProxyFailure(error: unknown): { statusCode: number; error: string } {
  const normalized = normalizeSessionDaemonRequestError(error);
  if (isSessionDaemonCancelledError(normalized)) {
    return { statusCode: 499, error: "Session daemon request cancelled" };
  }
  if (isSessionDaemonTimeoutError(normalized)) {
    return { statusCode: 504, error: `Session daemon timed out: ${SESSION_DAEMON_REQUEST_TIMEOUT_MESSAGE}` };
  }
  return { statusCode: 502, error: `Session daemon unavailable: ${normalized.message}` };
}

export function isSessionDaemonCancelledError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message === SESSION_DAEMON_REQUEST_CANCELLED_MESSAGE) return true;
  return error.cause instanceof Error && isSessionDaemonCancelledError(error.cause);
}

export function isSessionDaemonTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (isSessionDaemonCancelledError(error)) return false;
  if (error.message === SESSION_DAEMON_REQUEST_TIMEOUT_MESSAGE) return true;
  if (error.name === "TimeoutError") return true;
  if (error.message === "The operation was aborted" || error.message === "The operation was aborted due to timeout") return true;
  return error.cause instanceof Error && isSessionDaemonTimeoutError(error.cause);
}

import { HttpRequestError } from "./api/http";

const SESSION_DAEMON_TIMEOUT_TEXT = /timed out|operation was aborted|request cancelled/i;

export function isTransientSessionDaemonRequestError(error: unknown): boolean {
  if (error instanceof HttpRequestError && (error.status === 504 || error.status === 499)) return true;
  return error instanceof Error && SESSION_DAEMON_TIMEOUT_TEXT.test(error.message);
}

export function sessionDaemonErrorText(error: unknown): string {
  if (isTransientSessionDaemonRequestError(error)) {
    return "会话守护进程请求超时。当前对话仍在继续。";
  }
  return error instanceof Error ? error.message : String(error);
}

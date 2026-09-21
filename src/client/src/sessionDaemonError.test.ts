import { describe, expect, it } from "vitest";
import { HttpRequestError } from "./api/http";
import { isTransientSessionDaemonRequestError, sessionDaemonErrorText } from "./sessionDaemonError";

describe("session daemon browser errors", () => {
  it("treats gateway abort timeouts as a recoverable timeout, not a class-name crash", () => {
    const error = new HttpRequestError("Session daemon unavailable: The operation was aborted", 502);
    expect(isTransientSessionDaemonRequestError(error)).toBe(true);
    expect(sessionDaemonErrorText(error)).toBe("会话守护进程请求超时。当前对话仍在继续。");
  });

  it("treats a cancelled inbound request as recoverable", () => {
    const error = new HttpRequestError("Session daemon request cancelled", 499);
    expect(isTransientSessionDaemonRequestError(error)).toBe(true);
    expect(sessionDaemonErrorText(error)).toBe("会话守护进程请求超时。当前对话仍在继续。");
  });

  it("keeps ordinary failures as their message without the Error prefix", () => {
    expect(sessionDaemonErrorText(new Error("poll boom"))).toBe("poll boom");
    expect(isTransientSessionDaemonRequestError(new Error("poll boom"))).toBe(false);
  });
});

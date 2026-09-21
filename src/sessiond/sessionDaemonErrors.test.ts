import { describe, expect, it } from "vitest";
import {
  isSessionDaemonCancelledError,
  isSessionDaemonTimeoutError,
  normalizeSessionDaemonRequestError,
  SESSION_DAEMON_REQUEST_CANCELLED_MESSAGE,
  SESSION_DAEMON_REQUEST_TIMEOUT_MESSAGE,
  sessionDaemonProxyFailure,
} from "./sessionDaemonErrors.js";

describe("session daemon proxy errors", () => {
  it("maps Node abort timeouts to a 504 instead of daemon unavailability", () => {
    const aborted = new DOMException("The operation was aborted", "AbortError");
    expect(isSessionDaemonTimeoutError(aborted)).toBe(true);
    expect(sessionDaemonProxyFailure(aborted)).toEqual({
      statusCode: 504,
      error: `Session daemon timed out: ${SESSION_DAEMON_REQUEST_TIMEOUT_MESSAGE}`,
    });
  });

  it("keeps genuine connection failures as 502 unavailability", () => {
    expect(sessionDaemonProxyFailure(new Error("connection refused"))).toEqual({
      statusCode: 502,
      error: "Session daemon unavailable: connection refused",
    });
  });

  it("maps browser disconnect cancellation to 499 instead of daemon unavailability", () => {
    const cancelled = new DOMException(SESSION_DAEMON_REQUEST_CANCELLED_MESSAGE, "AbortError");
    expect(isSessionDaemonCancelledError(cancelled)).toBe(true);
    expect(isSessionDaemonTimeoutError(cancelled)).toBe(false);
    expect(sessionDaemonProxyFailure(cancelled)).toEqual({
      statusCode: 499,
      error: "Session daemon request cancelled",
    });
  });

  it("prefers a cancelled abort reason over the generic Node abort message", () => {
    const controller = new AbortController();
    controller.abort(new DOMException(SESSION_DAEMON_REQUEST_CANCELLED_MESSAGE, "AbortError"));
    const normalized = normalizeSessionDaemonRequestError(new DOMException("The operation was aborted", "AbortError"), controller.signal);
    expect(normalized.message).toBe(SESSION_DAEMON_REQUEST_CANCELLED_MESSAGE);
  });

  it("prefers the timeout abort reason over the generic Node abort message", () => {
    const controller = new AbortController();
    controller.abort(new Error(SESSION_DAEMON_REQUEST_TIMEOUT_MESSAGE));
    const normalized = normalizeSessionDaemonRequestError(new DOMException("The operation was aborted", "AbortError"), controller.signal);
    expect(normalized.message).toBe(SESSION_DAEMON_REQUEST_TIMEOUT_MESSAGE);
  });
});

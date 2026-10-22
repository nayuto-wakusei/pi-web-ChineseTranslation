import { describe, expect, it } from "vitest";
import { initialAppState } from "./appState";
import { BrowserErrorReporter, browserErrorScopeKey, sessionBrowserErrorScope, workspaceBrowserErrorScope } from "./browserErrors";

const session = sessionBrowserErrorScope("local", "session", { cwd: "/repo", projectId: "project", workspaceId: "workspace" });
const workspace = workspaceBrowserErrorScope("local", "project", "workspace");

function setup() {
  let state = initialAppState();
  return { reporter: new BrowserErrorReporter(() => state, (patch) => { state = { ...state, ...patch }; }), state: () => state };
}

describe("browser error read recovery", () => {
  it("clears only the captured recoverable error after a successful read", () => {
    const h = setup();
    h.reporter.report(session, "refresh unavailable", "session-refresh");
    h.reporter.report(workspace, "prompt delivery failed");
    const captured = h.reporter.captureRecovery(session, "session-refresh");
    expect(h.reporter.captureRecovery(session, "workspace-sessions-refresh")).toBeUndefined();
    expect(h.reporter.captureRecovery(workspace, "workspace-sessions-refresh")).toBeUndefined();
    h.reporter.clearRecovered(captured);
    expect(Object.values(h.state().browserErrors)).toEqual([{ scope: workspace, message: "prompt delivery failed" }]);
  });

  it("preserves replacement failures, including identical text, when an older read recovers", () => {
    const h = setup();
    h.reporter.report(session, "refresh unavailable", "session-refresh");
    const captured = h.reporter.captureRecovery(session, "session-refresh");
    h.reporter.report(session, "refresh unavailable", "session-refresh");
    const replacement = h.state().browserErrors;
    h.reporter.clearRecovered(captured);
    expect(h.state().browserErrors).toBe(replacement);
    h.reporter.report(session, "prompt delivery failed");
    h.reporter.clearRecovered(captured);
    expect(h.state().browserErrors[browserErrorScopeKey(session)]?.message).toBe("prompt delivery failed");
  });

  it("keeps same-id sessions on other machines and working directories independent", () => {
    const h = setup();
    const remote = sessionBrowserErrorScope("remote", "session", { cwd: "/repo" });
    const anotherCwd = sessionBrowserErrorScope("local", "session", { cwd: "/other" });
    for (const scope of [session, remote, anotherCwd]) h.reporter.report(scope, "offline", "session-refresh");
    h.reporter.clearRecovered(h.reporter.captureRecovery(session, "session-refresh"));
    expect(Object.values(h.state().browserErrors).map((error) => error.scope)).toEqual([remote, anotherCwd]);
  });
});

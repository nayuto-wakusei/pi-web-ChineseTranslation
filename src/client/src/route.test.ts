import { afterEach, describe, expect, it, vi } from "vitest";
import { isCreatingSessionId, readRoute, resolveWorkspacePanelRouteValue, routeMatchesSessionCreation, writeRoute, type AppRoute, type SessionCreationRouteIdentity } from "./route";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
});

function installWindow(href: string): { pushed: string[]; replaced: string[]; back: () => void; forward: () => void } {
  const url = new URL(href);
  const pushed: string[] = [];
  const replaced: string[] = [];
  const entries = [url];
  let historyIndex = 0;
  const location = {
    href: url.href,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
  const applyLocation = (next: URL) => {
    Object.assign(location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash });
  };
  const fakeWindow = {
    location,
    history: {
      pushState: vi.fn((_state: object, _title: string, next: URL | string) => {
        pushed.push(String(next));
        const nextUrl = new URL(String(next), location.href);
        entries.splice(historyIndex + 1);
        entries.push(nextUrl);
        historyIndex = entries.length - 1;
        applyLocation(nextUrl);
      }),
      replaceState: vi.fn((_state: object, _title: string, next: URL | string) => {
        replaced.push(String(next));
        const nextUrl = new URL(String(next), location.href);
        entries[historyIndex] = nextUrl;
        applyLocation(nextUrl);
      }),
      back: vi.fn(() => {
        if (historyIndex === 0) return;
        historyIndex -= 1;
        const previous = entries[historyIndex];
        if (previous !== undefined) applyLocation(previous);
      }),
      forward: vi.fn(() => {
        if (historyIndex >= entries.length - 1) return;
        historyIndex += 1;
        const next = entries[historyIndex];
        if (next !== undefined) applyLocation(next);
      }),
    },
  };
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
  return {
    pushed,
    replaced,
    back: () => { fakeWindow.history.back(); },
    forward: () => { fakeWindow.history.forward(); },
  };
}

describe("route helpers", () => {
  it("recognizes browser-owned session creation routes without treating ordinary sessions as transient", () => {
    expect(isCreatingSessionId("creating:abc123")).toBe(true);
    expect(isCreatingSessionId("old-session")).toBe(false);
    expect(isCreatingSessionId(undefined)).toBe(false);
  });

  it("guards session creation handoffs by machine, project, workspace, and token", () => {
    const identity: SessionCreationRouteIdentity = {
      machineId: "remote-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      sessionId: "creating:token-1",
    };
    const route: AppRoute = { ...identity, tool: "core:workspace.files", view: "chat" };

    expect(routeMatchesSessionCreation(route, identity)).toBe(true);
    expect(routeMatchesSessionCreation({ ...route, machineId: "remote-2" }, identity)).toBe(false);
    expect(routeMatchesSessionCreation({ ...route, projectId: "project-2" }, identity)).toBe(false);
    expect(routeMatchesSessionCreation({ ...route, workspaceId: "workspace-2" }, identity)).toBe(false);
    expect(routeMatchesSessionCreation({ ...route, sessionId: "creating:token-2" }, identity)).toBe(false);
    expect(routeMatchesSessionCreation({ ...route, view: "core:workspace.git" }, identity)).toBe(true);
  });

  it("reads only supported route fields from the current URL", () => {
    installWindow("http://localhost/app?machine=remote&project=p1&workspace=w1&session=s1&tool=git&view=files&core.workspace.files--file=src%2Fmain.ts&core.workspace.git--diff=README.md");

    expect(readRoute()).toEqual({
      machineId: "remote",
      projectId: "p1",
      workspaceId: "w1",
      sessionId: "s1",
      tool: "git",
      view: "files",
    });
  });

  it("keeps the terminal URL alias for the bundled terminal panel", () => {
    installWindow("http://localhost/app?tool=terminal&view=terminal");

    expect(readRoute()).toMatchObject({ tool: "terminal", view: "terminal" });
  });

  it("retains unknown routes until the selected machine's registry can resolve them", () => {
    installWindow("http://localhost/app?tool=settings&view=settings");

    expect(readRoute()).toMatchObject({ tool: "settings", view: "settings" });
    expect(resolveWorkspacePanelRouteValue(readRoute().tool, () => "example:settings")).toBe("example:settings");
    expect(resolveWorkspacePanelRouteValue("unknown", () => undefined)).toBeUndefined();
    expect(resolveWorkspacePanelRouteValue("example:unavailable", () => undefined)).toBe("example:unavailable");
  });

  it("writes compact URLs with push history and preserves path/hash", () => {
    const { pushed, replaced } = installWindow("http://localhost/app?old=1#section");
    const route: AppRoute = {
      machineId: "remote",
      projectId: "project/id",
      workspaceId: "workspace id",
      sessionId: "",
      tool: "core:workspace.files",
      view: "chat",
    };

    writeRoute(route);

    expect(pushed).toEqual(["http://localhost/app?old=1&machine=remote&project=project%2Fid&workspace=workspace+id&tool=core%3Aworkspace.files&view=chat#section"]);
    expect(replaced).toEqual([]);
  });

  it("restores machine-qualified targets while browser history moves backward and forward", () => {
    const { back, forward } = installWindow("http://localhost/app?machine=local&project=local-project&workspace=local-workspace&session=local-session");
    writeRoute({ machineId: "remote-1", projectId: "remote-project", workspaceId: "remote-workspace", sessionId: "remote-session", tool: undefined, view: "chat" });
    writeRoute({ machineId: "remote-2", projectId: "other-project", workspaceId: "other-workspace", sessionId: "other-session", tool: undefined, view: "chat" });

    back();
    expect(readRoute()).toMatchObject({ machineId: "remote-1", projectId: "remote-project", workspaceId: "remote-workspace", sessionId: "remote-session" });
    back();
    expect(readRoute()).toMatchObject({ machineId: "local", projectId: "local-project", workspaceId: "local-workspace", sessionId: "local-session" });
    forward();
    expect(readRoute()).toMatchObject({ machineId: "remote-1", projectId: "remote-project", workspaceId: "remote-workspace", sessionId: "remote-session" });
  });

  it("does not write history when the route is unchanged", () => {
    const { pushed, replaced } = installWindow("http://localhost/app?project=p1&tool=core%3Aworkspace.git");

    writeRoute({ machineId: undefined, projectId: "p1", workspaceId: undefined, sessionId: undefined, tool: "core:workspace.git", view: undefined });

    expect(pushed).toEqual([]);
    expect(replaced).toEqual([]);
  });
});

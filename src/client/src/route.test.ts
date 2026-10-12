import { afterEach, describe, expect, it, vi } from "vitest";
import { isCreatingSessionId, readRoute, resolveWorkspacePanelRouteValue, routeMatchesSessionCreation, writeRoute, type AppRoute, type SessionCreationRouteIdentity, parseMainView, resolveAppRoute, routeMatchesWorkspaceIdentity } from "./route";
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


const routeAliases: Record<string, AppRoute["tool"]> = {
  files: "files:workspace.files",
  "core:workspace.files": "files:workspace.files",
  git: "git:workspace.git",
  "core:workspace.git": "git:workspace.git",
  "git:workspace.git": "git:workspace.git",
};

function resolveWorkspacePanel(value: string): AppRoute["tool"] {
  return routeAliases[value];
}

describe("upstream foundation contracts", () => {
it("reads only supported route fields from the current URL", () => {
    installWindow("http://localhost/app?machine=remote&project=p1&workspace=w1&session=s1&tool=git%3Aworkspace.git&view=workspace&core.workspace.files--file=src%2Fmain.ts&git.workspace.git--diff=README.md");

    expect(resolveAppRoute(readRoute(), resolveWorkspacePanel)).toEqual({
      machineId: "remote",
      projectId: "p1",
      workspaceId: "w1",
      sessionId: "s1",
      tool: "git:workspace.git",
      view: "workspace",
    });
  });

it("ignores unsupported aliases while retaining qualified ids for retryable plugin loads", () => {
    installWindow("http://localhost/app?tool=terminal&view=settings");
    expect(resolveAppRoute(readRoute(), resolveWorkspacePanel)).toMatchObject({ tool: undefined, view: undefined });

    installWindow("http://localhost/app?tool=retryable%3Aworkspace.panel&view=retryable%3Aworkspace.panel");
    expect(resolveAppRoute(readRoute(), resolveWorkspacePanel)).toMatchObject({
      tool: "retryable:workspace.panel",
      view: undefined,
    });
  });

it("keeps legacy tool values for plugin resolution but rejects contribution-valued views", () => {
    installWindow("http://localhost/app?tool=git&view=core%3Aworkspace.git");

    expect(readRoute()).toMatchObject({ tool: "git", view: "core:workspace.git" });
    expect(resolveAppRoute(readRoute(), resolveWorkspacePanel)).toMatchObject({
      tool: "git:workspace.git",
      view: undefined,
    });
  });

it.each(["navigation", "chat", "workspace"] as const)("preserves explicit %s independently of tool resolution", (view) => {
    for (const tool of [undefined, "git", "retryable:workspace.panel"]) {
      const params = new URLSearchParams({ view });
      if (tool !== undefined) params.set("tool", tool);
      installWindow(`http://localhost/app?${params}`);
      const parsed = readRoute();
      const resolver = vi.fn(resolveWorkspacePanel);
      const resolved = resolveAppRoute(parsed, resolver);
      expect(parsed.view).toBe(view);
      expect(resolved.view).toBe(view);
      expect(resolver.mock.calls).toEqual(tool === undefined ? [] : [[tool]]);

      const { pushed } = installWindow("http://localhost/app");
      writeRoute(resolved);
      expect(pushed).toHaveLength(1);
      const written = new URL(pushed[0] ?? "");
      expect(written.searchParams.get("view")).toBe(view);
      installWindow(written.href);
      expect(readRoute().view).toBe(view);
    }
  });

it.each(["files", "git", "core:workspace.git", "git:workspace.git", "retryable:workspace.panel", "settings", "", "Workspace"])("rejects invalid view %j without changing the tool", (view) => {
    installWindow(`http://localhost/app?tool=files&view=${encodeURIComponent(view)}`);
    // Raw values survive parsing for warnings; only resolved state is structural.
    expect(readRoute().view).toBe(view === "" ? undefined : view);
    expect(resolveAppRoute(readRoute(), resolveWorkspacePanel)).toMatchObject({
      tool: "files:workspace.files",
      view: undefined,
    });
    expect(parseMainView(view)).toBeUndefined();
  });

it.each([undefined, null, 1, {}, []])("rejects non-string view %j", (view) => {
    expect(parseMainView(view)).toBeUndefined();
  });

it("matches contribution navigation to the exact machine, project, and workspace route", () => {
    expect(routeMatchesWorkspaceIdentity(
      { machineId: undefined, projectId: "p1", workspaceId: "w1" },
      { machineId: "local", projectId: "p1", workspaceId: "w1" },
    )).toBe(true);
    expect(routeMatchesWorkspaceIdentity(
      { machineId: "remote", projectId: "p1", workspaceId: "w1" },
      { machineId: "local", projectId: "p1", workspaceId: "w1" },
    )).toBe(false);
    expect(routeMatchesWorkspaceIdentity(
      { machineId: "remote", projectId: "p1", workspaceId: "other" },
      { machineId: "remote", projectId: "p1", workspaceId: "w1" },
    )).toBe(false);
  });

it("does not write history when the route is unchanged", () => {
    const { pushed, replaced } = installWindow("http://localhost/app?project=p1&tool=git%3Aworkspace.git");

    writeRoute({ machineId: undefined, projectId: "p1", workspaceId: undefined, sessionId: undefined, tool: "git:workspace.git", view: undefined });

    expect(pushed).toEqual([]);
    expect(replaced).toEqual([]);
  });
});

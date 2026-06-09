import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalCommandRun, Workspace } from "../../../shared/apiTypes";
import { terminalsApi, workspacesApi } from "./clients";

const workspace: Workspace = {
  id: "w/1",
  projectId: "p 1",
  path: "/repo",
  label: "repo",
  isMain: true,
  isGitRepo: true,
  isGitWorktree: true,
};

const commandRun: TerminalCommandRun = {
  id: "run1",
  origin: "core",
  projectId: workspace.projectId,
  workspaceId: workspace.id,
  terminalId: "t1",
  title: "Build",
  command: "npm test",
  status: "running",
  createdAt: "2026-05-25T00:00:00.000Z",
  metadata: {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("machine-scoped terminal command-run API", () => {
  it("deletes workspaces through the selected machine scope", async () => {
    const fetchMock = stubJsonFetch(commandRun);

    await workspacesApi.deleteWorkspace("p 1", "w/1", "remote a");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchCall(fetchMock, 0);
    expect(url).toBe("/api/machines/remote%20a/projects/p%201/workspaces/w%2F1");
    expect(init?.method).toBe("DELETE");
  });

  it("creates command runs through the selected machine scope", async () => {
    const fetchMock = stubJsonFetch(commandRun);

    await terminalsApi.runTerminalCommand("core", { workspace, title: "Build", command: "npm test", open: true }, "remote a");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchCall(fetchMock, 0);
    expect(url).toBe("/api/machines/remote%20a/projects/p%201/workspaces/w%2F1/terminal-command-runs");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(requestBody(init))).toEqual({ origin: "core", title: "Build", command: "npm test", metadata: {} });
  });

  it("closes all workspace terminals through the selected machine scope", async () => {
    const fetchMock = stubJsonFetch({ closed: true });

    await terminalsApi.closeWorkspaceTerminals("p 1", "w/1", "remote a");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchCall(fetchMock, 0);
    expect(url).toBe("/api/machines/remote%20a/projects/p%201/workspaces/w%2F1/terminals");
    expect(init?.method).toBe("DELETE");
  });

  it("lists, reads, and cancels command runs through the selected machine scope", async () => {
    const fetchMock = stubSequenceFetch([
      jsonResponse([commandRun]),
      jsonResponse(commandRun),
      jsonResponse(commandRun),
    ]);

    await terminalsApi.listCommandRuns({ projectId: "p 1", workspaceId: "w/1", statuses: ["running"], metadata: { "pi.operation": "workspace.delete" } }, "remote a");
    await terminalsApi.getCommandRun("run 1", "remote a");
    await terminalsApi.cancelCommandRun("run 1", "remote a");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/machines/remote%20a/terminal-command-runs?projectId=p+1&workspaceId=w%2F1&statuses=running&metadata=%7B%22pi.operation%22%3A%22workspace.delete%22%7D",
      "/api/machines/remote%20a/terminal-command-runs/run%201",
      "/api/machines/remote%20a/terminal-command-runs/run%201/cancel",
    ]);
    expect(fetchCall(fetchMock, 2)[1]?.method).toBe("POST");
  });

  it("returns undefined for missing command runs in the selected machine scope", async () => {
    const fetchMock = stubResponseFetch(new Response("{}", { status: 404 }));

    await expect(terminalsApi.getCommandRun("missing", "remote-a")).resolves.toBeUndefined();

    expect(fetchCall(fetchMock, 0)[0]).toBe("/api/machines/remote-a/terminal-command-runs/missing");
  });
});

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn<FetchLike>>;

function stubJsonFetch(value: unknown): FetchMock {
  return stubResponseFetch(jsonResponse(value));
}

function stubSequenceFetch(responses: Response[]): FetchMock {
  const fetchMock = vi.fn<FetchLike>(() => {
    const response = responses.shift();
    if (response === undefined) throw new Error("No fetch response queued");
    return Promise.resolve(response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubResponseFetch(response: Response): FetchMock {
  const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fetchCall(fetchMock: FetchMock, index: number): Parameters<FetchLike> {
  const call = fetchMock.mock.calls[index];
  if (call === undefined) throw new Error(`Missing fetch call ${String(index)}`);
  return call;
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") throw new Error("Expected string request body");
  return init.body;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

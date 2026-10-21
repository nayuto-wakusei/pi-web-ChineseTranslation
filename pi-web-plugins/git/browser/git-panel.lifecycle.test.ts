// @vitest-environment happy-dom
import { html, render, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue, PluginPeer, WorkspacePanelContext } from "../../../src/plugin-api.js";
import { createGitBrowserContributions } from "./git-panel.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("independent Git panel request lifecycle", () => {
  it("stops hidden polling, refreshes once on visibility, and never restarts after disconnect", async () => {
    vi.useFakeTimers();
    const visibility: { value: DocumentVisibilityState } = { value: "visible" };
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility.value);
    const request = backend();
    const harness = mountPanel(request);
    await harness.refresh();
    request.mockClear();
    visibility.value = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(24_000);
    expect(request).not.toHaveBeenCalled();

    visibility.value = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("status", { refresh: true });
    harness.draw();
    harness.draw();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(request).toHaveBeenCalledTimes(2);
    harness.disconnect();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("uses the large-list poll gate and returns to ordinary polling after a smaller status", async () => {
    vi.useFakeTimers();
    let response = status("large", Array.from({ length: 1_001 }, (_, index) => `${String(index)}.ts`));
    const request = backend(() => response);
    const harness = mountPanel(request);
    await harness.refresh();
    request.mockClear();
    await vi.advanceTimersByTimeAsync(24_000);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("status", null);
    response = status("small");
    await harness.refresh();
    request.mockClear();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(request).toHaveBeenCalledOnce();
  });

  it("joins an in-flight status refresh without force-trailing work or cancelling the initial load", async () => {
    vi.useFakeTimers();
    const pending = deferred<JsonValue>();
    const request = backend(() => pending.promise);
    const harness = mountPanel(request);
    const first = harness.refresh();
    const joined = harness.refresh();
    harness.draw();
    harness.draw();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(request).toHaveBeenCalledOnce();
    pending.resolve(status("current"));
    await Promise.all([first, joined]);
    harness.draw();
    expect(harness.mount.textContent).toContain("current");
    expect(request).toHaveBeenCalledOnce();
  });

  it("keeps a pending status scoped across disconnect/reconnect without resurrecting polling", async () => {
    vi.useFakeTimers();
    const pending = deferred<JsonValue>();
    const request = backend(() => pending.promise);
    const harness = mountPanel(request);
    const loading = harness.refresh();
    harness.disconnect();
    pending.resolve(status("cached"));
    await loading;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(request).toHaveBeenCalledOnce();
    harness.reconnect();
    harness.draw();
    expect(harness.mount.textContent).toContain("cached");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith("status", null);
  });

  it.each(["machine", "project", "workspace"] as const)("starts an independent %s refresh and never displays a late old status or error", async (scope) => {
    const oldStatus = deferred<JsonValue>();
    const oldRequest = backend(() => oldStatus.promise);
    const harness = mountPanel(oldRequest);
    const oldLoading = harness.refresh();
    const nextRequest = backend(() => status("new-scope"));
    harness.switchScope(scope, nextRequest);
    await harness.refresh();
    expect(nextRequest).toHaveBeenCalledOnce();
    oldStatus.resolve(status("obsolete-scope"));
    await oldLoading;
    harness.draw();
    expect(harness.mount.textContent).toContain("new-scope");
    expect(harness.mount.textContent).not.toContain("obsolete-scope");

    const obsoleteError = deferred<JsonValue>();
    const staleRequest = backend(() => obsoleteError.promise);
    harness.switchScope(scope, staleRequest);
    const staleLoading = harness.refresh();
    harness.switchScope(scope, nextRequest);
    await harness.refresh();
    obsoleteError.reject(new Error("obsolete-error"));
    await staleLoading;
    harness.draw();
    expect(harness.mount.querySelector('[role="alert"]')).toBeNull();
    expect(harness.mount.textContent).not.toContain("obsolete-error");
  });

  it.each(["other file", "same file", "stale error"] as const)("rejects an obsolete diff after selecting a newer %s", async (scenario) => {
    const pending = deferred<JsonValue>();
    let diffCalls = 0;
    const request = backend(() => status("main", ["a.ts", "b.ts"]), (input) => {
      diffCalls += 1;
      if (diffCalls <= 2) return pending.promise;
      return diff(input, "new-content");
    });
    const harness = mountPanel(request);
    await harness.refresh();
    harness.click("a.ts");
    harness.click(scenario === "same file" ? "a.ts" : "b.ts");
    await settle();
    if (scenario === "stale error") pending.reject(new Error("obsolete-diff-error"));
    else pending.resolve(diff(null, "obsolete-content"));
    await settle();
    harness.draw();
    expect(harness.mount.textContent).toContain("new-content");
    expect(harness.mount.textContent).not.toContain("obsolete-content");
    expect(harness.mount.querySelector('[role="alert"]')).toBeNull();
    expect(harness.mount.querySelector(".ui-file-row[aria-current='page']")?.textContent).toContain(scenario === "same file" ? "a.ts" : "b.ts");
  });

  it.each(["machine", "project", "workspace"] as const)("invalidates a pending diff when the %s changes, including a later return", async (scope) => {
    const pending = deferred<JsonValue>();
    let diffCalls = 0;
    const originalRequest = backend(() => status("original", ["a.ts"]), (input) => {
      diffCalls += 1;
      return diffCalls <= 2 ? pending.promise : diff(input, "fresh-return");
    });
    const harness = mountPanel(originalRequest);
    const originalContext = harness.context;
    await harness.refresh();
    harness.click("a.ts");
    harness.switchScope(scope, backend(() => status("other")));
    await harness.refresh();
    pending.resolve(diff(null, "obsolete-diff"));
    await settle();
    harness.draw();
    expect(harness.mount.querySelector(".git-diffs")).toBeNull();
    expect(harness.mount.textContent).not.toContain("obsolete-diff");
    harness.selectContext(originalContext);
    await settle();
    harness.draw();
    expect(harness.mount.textContent).toContain("fresh-return");
    expect(harness.mount.textContent).not.toContain("obsolete-diff");
  });

  it("preserves expansion on same-scope reconnect and keeps a different scope collapsed", async () => {
    const request = backend(() => status("tree", ["src/a.ts"]));
    const harness = mountPanel(request);
    await harness.refresh();
    harness.click("树形");
    harness.click("src");
    expect(harness.mount.querySelector('[aria-expanded="true"]')).not.toBeNull();
    harness.disconnect();
    harness.reconnect();
    harness.draw();
    expect(harness.mount.querySelector('[aria-expanded="true"]')).not.toBeNull();
    harness.switchScope("workspace", request);
    await harness.refresh();
    expect(harness.mount.querySelector('[aria-expanded="true"]')).toBeNull();
  });
});

function mountPanel(request: NonNullable<PluginPeer["request"]>) {
  const panel = createGitBrowserContributions("git", "git", html, svg).workspacePanels?.[0];
  if (panel === undefined) throw new Error("Missing Git panel");
  const mount = document.createElement("div");
  document.body.append(mount);
  let context: WorkspacePanelContext = {
    navigate: () => Promise.resolve(),
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "workspace", projectId: "project", path: "/fixture", label: "main", isMain: true, provider: { pluginId: "git", capabilities: { remove: true } } },
    files: { readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn() },
    peer: { request },
    host: { requestRender: vi.fn() },
    prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null },
    terminal: { open: vi.fn(), runCommand: vi.fn() },
  };
  const draw = () => { render(panel.render(context), mount); };
  function selectContext(next: WorkspacePanelContext): void {
    context = next;
    const params = new URLSearchParams({ machine: context.machine.id, project: context.workspace.projectId, workspace: context.workspace.id });
    window.history.replaceState({}, "", `/?${params.toString()}`);
    draw();
  }
  selectContext(context);
  return {
    mount,
    get context() { return context; },
    draw,
    selectContext,
    async refresh() { await panel.onInvalidate?.(context); draw(); },
    click(label: string) {
      const button = [...mount.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === label || candidate.querySelector(".ui-file-label")?.textContent.trim() === label);
      if (button === undefined) throw new Error(`Missing Git button ${label}: ${mount.textContent}`);
      button.click();
      draw();
    },
    disconnect() { mount.remove(); },
    reconnect() { document.body.append(mount); },
    switchScope(scope: "machine" | "project" | "workspace", nextRequest: NonNullable<PluginPeer["request"]>) {
      selectContext({ ...context, peer: { request: nextRequest },
        machine: scope === "machine" ? { ...context.machine, id: `${context.machine.id}-next`, kind: "remote" } : context.machine,
        workspace: scope === "machine" ? context.workspace : { ...context.workspace,
          ...(scope === "project" ? { projectId: `${context.workspace.projectId}-next` } : { id: `${context.workspace.id}-next` }),
        },
      });
    },
  };
}

function backend(getStatus: () => JsonValue | Promise<JsonValue> = () => status("main"), getDiff: (input: JsonValue) => JsonValue | Promise<JsonValue> = (input) => diff(input, "current")) {
  return vi.fn((operation: string, input: JsonValue): Promise<JsonValue> => Promise.resolve(operation === "status" ? getStatus() : getDiff(input)));
}

function status(branch: string, paths: string[] = []): JsonValue {
  return { isGitRepo: true, hash: branch, branch, submodules: [], files: paths.map((path) => ({ path, index: "unmodified", workingTree: "modified" })) };
}

function diff(input: JsonValue, text: string): JsonValue {
  const value = isRecord(input) ? input : {};
  return { path: typeof value["path"] === "string" ? value["path"] : "a.ts", staged: value["staged"] === true, hash: text, diff: text, truncated: false };
}

function isRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Uninitialized deferred"); };
  let reject: (error: Error) => void = () => { throw new Error("Uninitialized deferred"); };
  const promise = new Promise<T>((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

// @vitest-environment happy-dom
import { html, render, svg } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import type { JsonValue, WorkspacePanelContext } from "../../../src/plugin-api.js";
import { createGitBrowserContributions } from "./git-panel.js";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); window.history.replaceState({}, "", "/"); });

it("preserves a direct diff URL while the first status request is pending across reconnect", async () => {
  window.history.replaceState({}, "", "/?project=p&workspace=w&git.workspace.git--diff=example.json");
  let resolveStatus: (value: JsonValue) => void = () => { throw new Error("Status request was not started"); };
  const pendingStatus = new Promise<JsonValue>((resolve) => { resolveStatus = resolve; });
  const request = vi.fn((operation: string) => operation === "status" ? pendingStatus : Promise.resolve({ path: "example.json", staged: false, hash: "diff", diff: "fixture diff", truncated: false }));
  const context: WorkspacePanelContext = {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "w", projectId: "p", path: "/fixture", label: "master", isMain: true, provider: { pluginId: "git", capabilities: { remove: true } } },
    files: { readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn() }, peer: { request }, host: { requestRender: vi.fn() },
    navigate: vi.fn(() => Promise.resolve()),
    prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null },
    terminal: { open: vi.fn(), runCommand: vi.fn() },
  };
  const panel = createGitBrowserContributions("git", "git", html, svg).workspacePanels?.[0];
  if (panel === undefined) throw new Error("Missing Git panel");
  const mount = document.createElement("div");
  document.body.append(mount);
  render(panel.render(context), mount);
  expect(request).toHaveBeenCalledWith("status", { refresh: true });
  const activity = mount.querySelector("pi-web-git-panel-activity");
  if (activity === null) throw new Error("Missing activity lifecycle");
  activity.remove();
  mount.append(activity);
  expect(new URLSearchParams(window.location.search).get("git.workspace.git--diff")).toBe("example.json");
  resolveStatus({ isGitRepo: true, hash: "status", submodules: [], files: [{ path: "example.json", index: "unmodified", workingTree: "modified" }] });
  await vi.waitFor(() => { expect(request).toHaveBeenCalledWith("diff", { path: "example.json" }); });
});

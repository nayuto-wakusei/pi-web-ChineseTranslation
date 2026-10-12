// @vitest-environment happy-dom
import { html, render, svg } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import type { JsonValue, WorkspacePanelContext } from "../../../src/plugin-api.js";
import { createGitBrowserContributions } from "./git-panel.js";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); window.history.replaceState({}, "", "/"); });

it("counts directories in the 500-row budget and reveals a later selection from navigation", async () => {
  window.history.replaceState({}, "", "/?project=p&workspace=w");
  const request = vi.fn((operation: string): Promise<JsonValue> => Promise.resolve(operation === "status"
    ? { isGitRepo: true, hash: "large", truncated: true, submodules: [], files: Array.from({ length: 1001 }, (_, index) => ({ path: `dir-${String(index).padStart(4, "0")}/file.ts`, index: "unmodified", workingTree: "modified" })) }
    : { path: "dir-1000/file.ts", staged: false, hash: "diff", diff: "", truncated: false }));
  const mount = document.createElement("div");
  const panel = createGitBrowserContributions("git", "git", html, svg).workspacePanels?.[0];
  if (panel === undefined) throw new Error("Missing Git panel");
  const context: WorkspacePanelContext = {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "w", projectId: "p", path: "/fixture", label: "main", isMain: true, provider: { pluginId: "git", capabilities: { remove: true } } },
    files: { readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn() },
    peer: { request }, host: { requestRender: vi.fn() }, navigate: () => Promise.resolve(),
    prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null }, terminal: { open: vi.fn(), runCommand: vi.fn() },
  };
  const renderPanel = () => { render(panel.render(context), mount); };
  document.body.append(mount);
  renderPanel();
  await vi.waitFor(() => { renderPanel(); expect(mount.querySelectorAll(".git-row")).toHaveLength(500); });
  expect(mount.querySelector(".git-warning")?.textContent).toContain("文件列表已截断");
  click("树形");
  click("全部展开");
  expect(mount.querySelectorAll(".git-row")).toHaveLength(500);
  window.history.pushState({}, "", "/?project=p&workspace=w&git.workspace.git--diff=dir-1000%2Ffile.ts");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => { renderPanel(); expect(mount.querySelector(".git-row.is-selected")?.textContent).toContain("file.ts"); });

  function click(label: string): void {
    const button = [...mount.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === label);
    if (button === undefined) throw new Error(`Missing ${label}`);
    button.click();
    renderPanel();
  }
});

// @vitest-environment happy-dom
import { html, render, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue, WorkspacePanelContext } from "../../../src/plugin-api.js";
import { createGitBrowserContributions } from "./git-panel.js";
import type { GitStatusFile } from "./git-contract.js";
import { GIT_FILE_VIEW_STORAGE_KEY } from "./gitFileViewPreference.js";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("independent Git panel migrated interactions", () => {
  it("restores the saved tree view and persists a return to full-path list rows", async () => {
    localStorage.setItem(GIT_FILE_VIEW_STORAGE_KEY, "tree");
    const panel = await mountPanel([file("src/main.ts")]);
    expect(panel.button("树形").getAttribute("aria-pressed")).toBe("true");
    expect(panel.row("src/main.ts")).toBeUndefined();
    panel.click("src");
    expect(panel.row("main.ts")).toBeDefined();
    panel.click("列表");
    expect(localStorage.getItem(GIT_FILE_VIEW_STORAGE_KEY)).toBe("list");
    expect(panel.button("列表").getAttribute("aria-pressed")).toBe("true");
    expect(panel.row("main.ts")).toBeUndefined();
    panel.click("src/main.ts");
    expect(panel.request).toHaveBeenCalledWith("diff", { path: "src/main.ts" });
    expect(panel.request).toHaveBeenCalledWith("diff", { path: "src/main.ts", staged: true });
  });

  it("expands every root and nested directory, retains the partial label, and collapses all", async () => {
    localStorage.setItem(GIT_FILE_VIEW_STORAGE_KEY, "tree");
    const panel = await mountPanel([file("src/a.ts"), file("src/nested/b.ts"), file("tests/c.ts"), file("README.md")]);
    expect(panel.row("b.ts")).toBeUndefined();
    panel.click("src");
    expect(panel.row("a.ts")).toBeDefined();
    expect(panel.row("b.ts")).toBeUndefined();
    expect(panel.row("c.ts")).toBeUndefined();
    expect(panel.button("全部展开")).toBeDefined();
    panel.click("全部展开");
    for (const name of ["a.ts", "b.ts", "c.ts", "README.md"]) expect(panel.row(name)).toBeDefined();
    expect([...panel.mount.querySelectorAll(".ui-file-row[aria-expanded]")].map((row) => row.getAttribute("aria-expanded"))).toEqual(["true", "true", "true"]);
    panel.click("全部折叠");
    for (const name of ["a.ts", "b.ts", "c.ts"]) expect(panel.row(name)).toBeUndefined();
    expect(panel.row("README.md")).toBeDefined();
    expect([...panel.mount.querySelectorAll(".ui-file-row[aria-expanded]")].map((row) => row.getAttribute("aria-expanded"))).toEqual(["false", "false"]);
    expect(panel.button("全部展开")).toBeDefined();
  });

  it("expands and collapses every list submodule and wires pointer and inner-file diffs", async () => {
    const panel = await mountPanel([
      file("vendor/harl", { submoduleFromCommit: "abc1234", submoduleToCommit: "def5678" }),
      file("vendor/harl/lib.ts"),
      file("vendor/other", { submoduleFromCommit: "123abcd", submoduleToCommit: "456defg" }),
      file("vendor/other/other.ts"),
    ], ["vendor/harl", "vendor/other"]);
    expect(panel.row("abc1234 → def5678")).toBeUndefined();
    expect(panel.row("lib.ts")).toBeUndefined();
    panel.click("全部展开");
    expect(panel.row("123abcd → 456defg")).toBeDefined();
    expect(panel.row("other.ts")).toBeDefined();
    panel.click("abc1234 → def5678");
    expect(panel.request).toHaveBeenCalledWith("diff", { path: "vendor/harl" });
    panel.click("lib.ts");
    expect(panel.request).toHaveBeenCalledWith("diff", { path: "vendor/harl/lib.ts" });
    panel.click("全部折叠");
    for (const name of ["abc1234 → def5678", "123abcd → 456defg", "lib.ts", "other.ts"]) expect(panel.row(name)).toBeUndefined();
    expect(panel.button("全部展开")).toBeDefined();
  });

  it("renders M/A/D/U state labels with working-tree state taking precedence", async () => {
    const panel = await mountPanel([
      file("m.ts", { index: "added", workingTree: "modified" }),
      file("a.ts", { index: "added", workingTree: "unmodified" }),
      file("d.ts", { workingTree: "deleted" }),
      file("u.ts", { workingTree: "untracked" }),
    ]);
    for (const [name, label] of [["m.ts", "M"], ["a.ts", "A"], ["d.ts", "D"], ["u.ts", "U"]] as const) {
      expect(panel.row(name)?.querySelector(".ui-file-meta")?.textContent).toBe(label);
    }
  });

  it("keeps expand/collapse before the view toggle and refresh after it in DOM order", async () => {
    const panel = await mountPanel([file("src/a.ts")]);
    const controls = () => [...(panel.mount.querySelector(".git-toolbar-actions")?.children ?? [])];
    const labels = () => controls().map((control) => control.classList.contains("git-view-toggle") ? "view-toggle" : control.textContent.trim());
    expect(labels()).toEqual(["view-toggle", "刷新"]);
    const toggle = panel.mount.querySelector(".git-view-toggle");
    const refresh = panel.button("刷新");
    panel.click("树形");
    expect(labels()).toEqual(["全部展开", "view-toggle", "刷新"]);
    expect(controls()[1]).toBe(toggle);
    expect(controls()[2]).toBe(refresh);
    panel.click("全部展开");
    expect(labels()).toEqual(["全部折叠", "view-toggle", "刷新"]);
    panel.click("列表");
    expect(controls()).toEqual([toggle, refresh]);
  });
});

async function mountPanel(files: GitStatusFile[], submodules: string[] = []) {
  window.history.replaceState({}, "", "/?project=project&workspace=workspace");
  const request = vi.fn((operation: string, input: JsonValue): Promise<JsonValue> => {
    if (operation === "status") return Promise.resolve({ isGitRepo: true, hash: "status", files: files.map((entry) => ({ ...entry })), submodules });
    if (!isRecord(input) || typeof input["path"] !== "string") throw new Error("Missing diff input");
    return Promise.resolve({ path: input["path"], staged: input["staged"] === true, hash: "diff", diff: "", truncated: false });
  });
  const panel = createGitBrowserContributions("git", "git", html, svg).workspacePanels?.[0];
  if (panel === undefined) throw new Error("Missing Git panel");
  const context: WorkspacePanelContext = {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "workspace", projectId: "project", path: "/fixture", label: "main", isMain: true, provider: { pluginId: "git", capabilities: { remove: true } } },
    files: { readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn() },
    peer: { request }, host: { requestRender: vi.fn() }, navigate: () => Promise.resolve(),
    prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null }, terminal: { open: vi.fn(), runCommand: vi.fn() },
  };
  const mount = document.createElement("div");
  document.body.append(mount);
  const draw = () => { render(panel.render(context), mount); };
  draw();
  await panel.onInvalidate?.(context);
  draw();
  const row = (name: string) => [...mount.querySelectorAll<HTMLButtonElement>(".ui-file-row")].find((candidate) => candidate.querySelector(".ui-file-label")?.textContent.trim() === name);
  const button = (name: string) => {
    const candidate = row(name) ?? [...mount.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent.trim() === name);
    if (candidate === undefined) throw new Error(`Missing Git button ${name}`);
    return candidate;
  };
  return { mount, request, row, button, click(name: string) { button(name).click(); draw(); } };
}

function file(path: string, patch: Partial<GitStatusFile> = {}): GitStatusFile {
  return { path, index: "unmodified", workingTree: "modified", ...patch };
}

function isRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

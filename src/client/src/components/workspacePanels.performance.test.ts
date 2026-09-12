// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import type { WorkspacePanelContext } from "../plugins/types";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel";
import { WorkspaceGitPanel } from "./WorkspaceGitPanel";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

it("renders files in 200-row batches and reveals a later selection", async () => {
  const context = panelContext();
  context.fileTree = Array.from({ length: 1000 }, (_, i) => ({ name: `file-${String(i)}`, path: `file-${String(i)}`, type: "file" }));
  const panel = new WorkspaceFilesPanel();
  panel.context = context;
  document.body.append(panel);
  await panel.updateComplete;
  expect(panel.shadowRoot?.querySelectorAll(".row")).toHaveLength(200);
  const more = panel.shadowRoot?.querySelector(".tree-more");
  if (!(more instanceof HTMLButtonElement)) throw new Error("Missing show more button");
  more.click();
  await panel.updateComplete;
  expect(panel.shadowRoot?.querySelectorAll(".row")).toHaveLength(400);
  panel.context = { ...context, selectedFilePath: "file-899" };
  await panel.updateComplete;
  expect(panel.shadowRoot?.querySelector(".row.selected")?.textContent).toContain("file-899");
});

it("counts directory rows in the Git budget even after expanding all directories", async () => {
  const context = panelContext();
  context.gitStatus = { isGitRepo: true, hash: "large", submodules: [], files: Array.from({ length: 1001 }, (_, i) => ({ path: `dir-${String(i).padStart(4, "0")}/file.ts`, index: "unmodified", workingTree: "modified" })) };
  const panel = new WorkspaceGitPanel();
  panel.context = context;
  document.body.append(panel);
  await panel.updateComplete;
  expect(panel.shadowRoot?.querySelectorAll(".row")).toHaveLength(500);
  const click = (label: string) => {
    const button = [...(panel.shadowRoot?.querySelectorAll("button") ?? [])].find((item) => item.textContent.trim() === label);
    if (button === undefined) throw new Error(`Missing ${label}`);
    button.click();
  };
  click("树");
  await panel.updateComplete;
  click("全部展开");
  await panel.updateComplete;
  expect(panel.shadowRoot?.querySelectorAll(".row")).toHaveLength(500);
  panel.context = { ...context, selectedDiffPath: "dir-1000/file.ts" };
  await panel.updateComplete;
  const selected = panel.shadowRoot?.querySelector(".row.selected");
  expect(selected?.textContent).toContain("file.ts");
});

function panelContext(): WorkspacePanelContext {
  return {
    machine: { id: "local", name: "本机", kind: "local" },
    workspace: { id: "w", projectId: "p", path: "/repo", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false },
    state: initialAppState(),
    files: { readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn() },
    prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null },
    terminal: { open: vi.fn(), runCommand: vi.fn() }, host: { requestRender: vi.fn() },
    fileTree: [], expandedDirs: {}, selectedFilePath: undefined, selectedFileContent: undefined, fileTreeStale: false,
    gitStatus: undefined, selectedDiffPath: undefined, selectedDiff: undefined, selectedStagedDiff: undefined, gitStale: false,
    activeTerminalCount: 0, selectedTerminalId: undefined, terminalAutoStart: false, workspaceUploadDefaultFolder: "uploads",
    onRefreshFiles: vi.fn(), onCreateFile: vi.fn(), onCreateDirectory: vi.fn(), onMoveSelectedPath: vi.fn(), onDeleteSelectedPath: vi.fn(), onDownloadSelectedFile: vi.fn(),
    onExpandDir: vi.fn(), onSelectDirectory: vi.fn(), onSelectFile: vi.fn(), onStartWorkspaceUpload: vi.fn(), onCancelWorkspaceUpload: vi.fn(), onClearWorkspaceUpload: vi.fn(),
    onRefreshGit: vi.fn(), onSelectDiff: vi.fn(), onSelectTerminal: vi.fn(),
  };
}

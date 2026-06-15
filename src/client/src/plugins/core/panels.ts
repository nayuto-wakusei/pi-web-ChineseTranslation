import { html, type TemplateResult } from "lit";
import type { FileContentResponse, FileTreeEntry, GitDiffResponse, GitStatusResponse } from "../../api";
import { workspaceImagePreviewUrl } from "../../api/urls";
import { MAX_IMAGE_PREVIEW_BYTES, MAX_IMAGE_PREVIEW_LABEL } from "../../../../shared/workspaceFiles";
import { renderBuiltinTabIcon } from "../../components/tabIcons";
import type { WorkspacePanelContribution, WorkspacePanelContext } from "../types";

export function createCoreWorkspacePanels(): WorkspacePanelContribution[] {
  return [
    {
      id: "workspace.files",
      title: "文件",
      icon: renderBuiltinTabIcon("files"),
      order: 10,
      render: renderFiles,
    },
    {
      id: "workspace.git",
      title: "Git",
      icon: renderBuiltinTabIcon("git"),
      order: 20,
      visible: ({ workspace }) => workspace.isGitRepo,
      render: renderGit,
    },
    {
      id: "workspace.terminal",
      title: "终端",
      icon: renderBuiltinTabIcon("terminal"),
      order: 30,
      badge: (context) => context.activeTerminalCount > 0 ? context.activeTerminalCount : undefined,
      render: renderTerminal,
    },
  ];
}

function renderFiles(context: WorkspacePanelContext): TemplateResult {
  const uploadEnabled = context.machine.kind === "local";
  return html`
    <section class="toolbar">
      <strong>文件</strong>
      ${context.fileTreeStale ? html`<span class="stale">过期</span>` : null}
      <div class="toolbar-actions">
        <button @click=${context.onRefreshFiles}>刷新</button>
        <button @click=${() => { promptCreateFile(context); }}>新建文件</button>
        <button @click=${() => { promptCreateDirectory(context); }}>新建目录</button>
        ${context.selectedFilePath === undefined ? null : html`
          ${selectedPathKind(context) === "file" ? html`<button @click=${() => { context.onDownloadSelectedFile(); }}>下载</button>` : null}
          <button @click=${() => { promptMoveSelectedPath(context); }}>移动</button>
          <button class="danger" @click=${() => { confirmDeleteSelectedPath(context); }}>删除</button>
        `}
        ${uploadEnabled
          ? html`
              <label class="file-upload-button" role="button" tabindex="0" aria-label="上传文件" @keydown=${activateUploadInput}>
                上传
                <input type="file" multiple hidden @change=${(event: Event) => { uploadSelectedFiles(context, event); }} />
              </label>
            `
          : html`<span class="file-upload-button disabled" title="远端机器暂不支持上传" aria-disabled="true">上传</span>`}
      </div>
    </section>
    <section class="split">
      <div class="list tree">
        ${context.fileTree.length === 0 ? html`<p class="muted">尚未加载文件。</p>` : context.fileTree.map((entry) => renderTreeEntry(context, entry, 0))}
      </div>
      <div class="viewer">
        ${renderFileViewer(context)}
      </div>
    </section>
  `;
}

function activateUploadInput(event: KeyboardEvent): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const input = target.querySelector("input[type='file']");
  if (input instanceof HTMLInputElement) input.click();
}

function uploadSelectedFiles(context: WorkspacePanelContext, event: Event): void {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement) || input.files === null) return;
  context.onUploadFiles(Array.from(input.files));
  input.value = "";
}

function promptCreateFile(context: WorkspacePanelContext): void {
  const value = window.prompt("新建文件路径", defaultPathInSelectedDirectory(context, "new-file.txt"));
  if (value === null || value.trim() === "") return;
  context.onCreateFile(value.trim());
}

function promptCreateDirectory(context: WorkspacePanelContext): void {
  const value = window.prompt("新建目录路径", defaultPathInSelectedDirectory(context, "new-folder"));
  if (value === null || value.trim() === "") return;
  context.onCreateDirectory(value.trim());
}

function promptMoveSelectedPath(context: WorkspacePanelContext): void {
  const current = context.selectedFilePath;
  if (current === undefined || current === "") return;
  const value = window.prompt(selectedPathKind(context) === "directory" ? "移动或重命名目录到" : "移动或重命名文件到", current);
  if (value === null || value.trim() === "" || value.trim() === current) return;
  context.onMoveSelectedPath(value.trim());
}

function confirmDeleteSelectedPath(context: WorkspacePanelContext): void {
  const current = context.selectedFilePath;
  if (current === undefined || current === "") return;
  const kind = selectedPathKind(context) === "directory" ? "空目录" : "文件";
  if (!window.confirm(`删除${kind} ${current}？`)) return;
  context.onDeleteSelectedPath();
}

function renderTreeEntry(context: WorkspacePanelContext, entry: FileTreeEntry, depth: number): TemplateResult {
  const children = context.expandedDirs[entry.path];
  const hasChildren = children !== undefined;
  const selected = context.selectedFilePath === entry.path;
  return html`
    <button class=${selected ? "row selected" : "row"} style=${`--depth:${String(depth)}`} @click=${() => { selectTreeEntry(context, entry); }}>
      <span>${entry.type === "directory" ? (hasChildren ? "▾" : "▸") : "·"}</span>
      <span>${entry.name}</span>
    </button>
    ${hasChildren ? children.map((child) => renderTreeEntry(context, child, depth + 1)) : null}
  `;
}

function selectTreeEntry(context: WorkspacePanelContext, entry: FileTreeEntry): void {
  if (entry.type === "directory") {
    context.onSelectDirectory(entry.path);
    context.onExpandDir(entry.path);
  }
  else context.onSelectFile(entry.path);
}

function selectedPathKind(context: WorkspacePanelContext): FileTreeEntry["type"] {
  const path = context.selectedFilePath;
  if (path === undefined) return "file";
  return findTreeEntry(context, path)?.type ?? "file";
}

function defaultPathInSelectedDirectory(context: WorkspacePanelContext, name: string): string {
  const selectedPath = context.selectedFilePath;
  if (selectedPath === undefined || selectedPath === "") return name;
  if (selectedPathKind(context) === "directory") return `${selectedPath}/${name}`;
  const separator = selectedPath.lastIndexOf("/");
  return separator === -1 ? name : `${selectedPath.slice(0, separator)}/${name}`;
}

function findTreeEntry(context: WorkspacePanelContext, path: string): FileTreeEntry | undefined {
  const rootMatch = context.fileTree.find((entry) => entry.path === path);
  if (rootMatch !== undefined) return rootMatch;
  for (const entries of Object.values(context.expandedDirs)) {
    const match = entries.find((entry) => entry.path === path);
    if (match !== undefined) return match;
  }
  return undefined;
}

function renderFileViewer(context: WorkspacePanelContext): TemplateResult {
  const file = context.selectedFileContent;
  if (context.selectedFilePath === undefined || context.selectedFilePath === "") return html`<p class="muted">请选择文件。</p>`;
  if (selectedPathKind(context) === "directory") return html`<p class="muted">已选择目录 ${context.selectedFilePath}。</p>`;
  if (file === undefined) return html`<p class="muted">正在加载 ${context.selectedFilePath}…</p>`;
  if (file.mediaType === "image") return renderImageViewer(context, file);
  if (file.binary) return html`<p class="muted">二进制文件：${file.path} · ${formatFileSize(file.size)}</p>`;
  loadCodeViewer();
  return html`
    <div class="viewer-header"><strong>${file.path}</strong><small>${file.language ?? "文本"}${file.truncated ? " · 已截断" : ""}</small></div>
    <code-viewer .content=${file.content} .language=${file.language}></code-viewer>
  `;
}

function renderImageViewer(context: WorkspacePanelContext, file: FileContentResponse): TemplateResult {
  const metadata = `${file.mimeType ?? "image"} · ${formatFileSize(file.size)}`;
  if (file.size > MAX_IMAGE_PREVIEW_BYTES) {
    return html`
      <div class="viewer-header"><strong>${file.path}</strong><small>${metadata}</small></div>
      <p class="muted">图片过大，无法预览：${formatFileSize(file.size)} · 限制 ${MAX_IMAGE_PREVIEW_LABEL}</p>
    `;
  }
  const src = workspaceImagePreviewUrl(context.workspace.projectId, context.workspace.id, file.path, { modifiedAt: file.modifiedAt, machineId: context.machine.id });
  return html`
    <div class="viewer-header"><strong>${file.path}</strong><small>${metadata}</small></div>
    <div class="image-preview">
      <img src=${src} alt=${file.path} decoding="async" />
    </div>
  `;
}

function renderTerminal(context: WorkspacePanelContext): TemplateResult {
  loadTerminalPanel();
  return html`<terminal-panel .workspace=${context.workspace} .machineId=${context.machine.id} .selectedTerminalId=${context.selectedTerminalId} .autoStart=${context.terminalAutoStart} .onSelectTerminal=${context.onSelectTerminal}></terminal-panel>`;
}

function renderGit(context: WorkspacePanelContext): TemplateResult {
  const status = context.gitStatus;
  return html`
    <section class="toolbar">
      <strong>Git</strong>
      ${context.gitStale ? html`<span class="stale">过期</span>` : null}
      <button @click=${context.onRefreshGit}>刷新</button>
    </section>
    <section class="split">
      <div class="list">
        ${status === undefined ? html`<p class="muted">尚未加载状态。</p>` : !status.isGitRepo ? html`<p class="muted">不是 Git 仓库。</p>` : html`
          <p class="summary">${gitSummary(status)}</p>
          ${status.files.length === 0 ? html`<p class="muted">没有变更。</p>` : status.files.map((file) => html`
            <button class="row ${context.selectedDiffPath === file.path ? "selected" : ""}" @click=${() => { context.onSelectDiff(file.path); }}>
              <span>${stateLabel(file.index, file.workingTree)}</span>
              <span>${file.path}</span>
            </button>
          `)}
        `}
      </div>
      <div class="viewer">
        ${renderDiffViewer(context)}
      </div>
    </section>
  `;
}

function renderDiffViewer(context: WorkspacePanelContext): TemplateResult {
  if (context.selectedDiffPath === undefined || context.selectedDiffPath === "") return html`<p class="muted">请选择一个已变更文件。</p>`;
  const unstaged = context.selectedDiff;
  const staged = context.selectedStagedDiff;
  if (unstaged === undefined || staged === undefined) return html`<p class="muted">正在加载 diff…</p>`;
  const diffs = [staged, unstaged].filter((diff) => diff.diff !== "");
  if (diffs.length === 0) return html`<p class="muted">没有 staged 或 unstaged diff。</p>`;
  return html`
    <div class=${diffs.length === 1 ? "diffs single" : "diffs"}>
      ${diffs.map((diff) => renderDiffSection(diff))}
    </div>
  `;
}

function renderDiffSection(diff: GitDiffResponse): TemplateResult {
  loadCodeViewer();
  return html`
    <section class="diff-section">
      <div class="viewer-header"><strong>${diff.path ?? "diff"}</strong><small>${diff.staged ? "已暂存" : "未暂存"}${diff.truncated ? " · 已截断" : ""}</small></div>
      <code-viewer .content=${diff.diff} .language=${"diff"}></code-viewer>
    </section>
  `;
}

function loadCodeViewer(): void {
  void import("../../components/CodeViewer");
}

function loadTerminalPanel(): void {
  void import("../../components/TerminalPanel");
}

function gitSummary(status: GitStatusResponse): string {
  const branch = status.branch ?? "分离 HEAD";
  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;
  return ahead === 0 && behind === 0 ? branch : `${branch} · ↑${String(ahead)} ↓${String(behind)}`;
}

function stateLabel(index: string, workingTree: string): string {
  const label = workingTree !== "unmodified" ? workingTree : index;
  return label.slice(0, 1).toUpperCase();
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${String(size)} B`;
  const kib = size / 1024;
  if (kib < 1024) return `${formatScaledFileSize(kib)} KB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${formatScaledFileSize(mib)} MB`;
  return `${formatScaledFileSize(mib / 1024)} GB`;
}

function formatScaledFileSize(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

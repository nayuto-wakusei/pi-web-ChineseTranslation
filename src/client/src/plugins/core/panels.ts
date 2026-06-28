import { html, type TemplateResult } from "lit";
import type { GitDiffResponse, GitStatusResponse } from "../../api";
import { renderBuiltinTabIcon } from "../../components/tabIcons";
import "../../components/WorkspaceFilesPanel";
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
  return html`<workspace-files-panel .context=${context}></workspace-files-panel>`;
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
  loadUnifiedDiffViewer();
  return html`
    <section class="diff-section">
      <div class="viewer-header"><strong>${diff.path ?? "diff"}</strong><small>${diff.staged ? "已暂存" : "未暂存"}${diff.truncated ? " · 已截断" : ""}</small></div>
      <unified-diff-viewer .diff=${diff.diff}></unified-diff-viewer>
    </section>
  `;
}

function loadUnifiedDiffViewer(): void {
  void import("../../components/UnifiedDiffViewer");
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

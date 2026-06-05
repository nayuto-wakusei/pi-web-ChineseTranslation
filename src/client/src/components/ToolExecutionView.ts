import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ToolExecutionPart } from "./shared";

const MAX_COLLAPSED_DIFF_LINES = 180;

@customElement("tool-execution-view")
export class ToolExecutionView extends LitElement {
  @property({ attribute: false }) execution: ToolExecutionPart | undefined;
  @state() private showFullDiff = false;
  @state() private copied = false;
  @state() private diffOpen = true;

  override render() {
    const execution = this.execution;
    if (execution === undefined) return null;

    const edit = execution.toolName === "edit";
    const path = pathFromArgs(execution.args);
    const actualDiff = diffFromDetails(execution.details);
    const preview = execution.preview;
    const visibleDiff = actualDiff ?? preview?.diff;
    const diffStats = visibleDiff === undefined ? undefined : countDiffLines(visibleDiff);
    const previewMismatch = actualDiff !== undefined && preview?.diff !== undefined && actualDiff !== preview.diff;
    const errorText = execution.status === "error" ? execution.resultText : preview?.error;
    const bodyText = visibleDiff === undefined ? execution.resultText : undefined;

    return html`
      <section class=${`tool-card ${execution.status}`}>
        <div class="tool-header">
          <div class="tool-title">
            <span class="status-icon" aria-hidden="true">${statusIcon(execution.status)}</span>
            <strong>${execution.toolName}</strong>
            ${path === undefined ? html`<span class="summary">${execution.summary}</span>` : html`<span class="path">${path}</span>`}
          </div>
          <div class="tool-meta">
            ${editCountLabel(execution) === undefined ? null : html`<span>${editCountLabel(execution)}</span>`}
            ${diffStats === undefined ? null : html`<span class="diff-stats"><b class="added">+${diffStats.added}</b><span>/</span><b class="removed">-${diffStats.removed}</b></span>`}
            <span class="status-label">${statusLabel(execution.status)}</span>
          </div>
        </div>

        ${previewMismatch ? html`<p class="notice">实际应用的 diff 与预览不同。</p>` : null}
        ${errorText === undefined || errorText === "" ? null : html`<pre class="error-text">${errorText}</pre>`}
        ${visibleDiff === undefined ? this.renderTextBody(bodyText, execution.status === "error") : this.renderDiffBody(visibleDiff, actualDiff === undefined ? "预览 diff" : "已应用 diff")}
        ${!edit && visibleDiff === undefined && (bodyText === undefined || bodyText === "") ? html`<p class="muted">${execution.summary}</p>` : null}
      </section>
    `;
  }

  private renderTextBody(text: string | undefined, open: boolean) {
    if (text === undefined || text === "") return null;
    return html`
      <details class="text-body" ?open=${open}>
        <summary>结果</summary>
        <pre>${text}</pre>
      </details>
    `;
  }

  private renderDiffBody(diff: string, label: string) {
    const lines = diff.split("\n");
    const truncated = !this.showFullDiff && lines.length > MAX_COLLAPSED_DIFF_LINES;
    const visibleLines = truncated ? lines.slice(0, MAX_COLLAPSED_DIFF_LINES) : lines;
    return html`
      <details class="diff-details" ?open=${this.diffOpen} @toggle=${(event: Event) => { this.onDiffToggle(event); }}>
        <summary>
          <span>${label}</span>
          <small>${String(lines.length)} 行</small>
        </summary>
        <div class="diff-toolbar">
          <span>${truncated ? `显示 ${String(visibleLines.length)} / ${String(lines.length)} 行` : "完整 diff"}</span>
          <button type="button" @click=${() => { void this.copyDiff(diff); }}>${this.copied ? "已复制" : "复制 diff"}</button>
        </div>
        <pre class="diff" aria-label=${label}><code class="diff-content">${visibleLines.map((line) => html`<span class=${diffLineClass(line)}>${line}</span>`)}</code></pre>
        ${truncated ? html`
          <button class="show-more" type="button" @click=${() => { this.showFullDiff = true; }}>
            显示全部 ${String(lines.length)} 行 diff
          </button>
        ` : null}
      </details>
    `;
  }

  private onDiffToggle(event: Event): void {
    const details = event.currentTarget;
    if (details instanceof HTMLDetailsElement) this.diffOpen = details.open;
  }

  private async copyDiff(diff: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(diff);
      this.copied = true;
      window.setTimeout(() => { this.copied = false; }, 1200);
    } catch {
      this.copied = false;
    }
  }

  static override styles = css`
    :host { display: block; width: 100%; max-width: 100%; min-width: 0; color: var(--pi-text); }
    .tool-card { display: grid; gap: 8px; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow: hidden; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); padding: 9px; color: var(--pi-text); }
    .tool-card.running, .tool-card.pending { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); }
    .tool-card.success { border-color: var(--pi-success-border); background: var(--pi-success-bg); }
    .tool-card.error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-bg)); }
    .tool-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; }
    .tool-title { display: inline-flex; align-items: baseline; gap: 7px; min-width: 0; }
    .status-icon { flex: 0 0 auto; color: var(--pi-muted); }
    strong { color: var(--pi-text); }
    .path, .summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-accent); font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .summary { color: var(--pi-muted); font-family: inherit; }
    .tool-meta { flex: 0 0 auto; display: inline-flex; align-items: baseline; gap: 8px; color: var(--pi-muted); font-size: 12px; }
    .diff-stats { display: inline-flex; gap: 3px; }
    .added, .diff .added { color: var(--pi-success); }
    .removed, .diff .removed { color: var(--pi-danger); }
    .status-label { text-transform: uppercase; letter-spacing: .04em; color: var(--pi-muted); }
    .notice { margin: 0; color: var(--pi-warning); }
    .muted { margin: 0; color: var(--pi-muted); }
    .error-text { margin: 0; border: 1px solid var(--pi-danger); border-radius: 7px; background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-bg)); color: var(--pi-danger); padding: 8px; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .text-body { border-top: 1px solid var(--pi-border-muted); padding-top: 6px; }
    .text-body pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--pi-text); }
    .diff-details { min-width: 0; max-width: 100%; border-top: 1px solid var(--pi-border-muted); padding-top: 6px; }
    .diff-details > summary { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; color: var(--pi-muted); cursor: pointer; }
    .diff-details > summary span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .diff-details > summary small { flex: 0 0 auto; color: var(--pi-dim); }
    .diff-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; margin-top: 8px; color: var(--pi-muted); font-size: 12px; }
    .diff-toolbar span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    button { border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-text); padding: 3px 7px; font: 12px system-ui, sans-serif; cursor: pointer; }
    button:hover, button:focus { border-color: var(--pi-accent); }
    .diff { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; margin: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; border: 1px solid var(--pi-border-muted); border-radius: 7px; background: var(--pi-bg); padding: 8px 0; color: var(--pi-muted); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; }
    .diff-content { display: block; width: max-content; min-width: 100%; }
    .diff span { display: block; min-height: 1.45em; padding: 0 8px; white-space: pre; }
    .diff .context { color: var(--pi-muted); }
    .diff .hunk { color: var(--pi-accent); }
    .diff .file { color: var(--pi-dim); }
    .diff .meta { color: var(--pi-dim); }
    .diff .added { background: color-mix(in srgb, var(--pi-success) 12%, transparent); }
    .diff .removed { background: color-mix(in srgb, var(--pi-danger) 12%, transparent); }
    .show-more { justify-self: start; }
  `;
}

function pathFromArgs(args: unknown): string | undefined {
  return getString(args, "path") ?? getString(args, "file_path");
}

function editCountLabel(execution: ToolExecutionPart): string | undefined {
  if (execution.toolName !== "edit") return undefined;
  const edits = getProperty(execution.args, "edits");
  if (Array.isArray(edits)) return `${String(edits.length)} 处编辑`;
  if (typeof getProperty(execution.args, "oldText") === "string" && typeof getProperty(execution.args, "newText") === "string") return "1 处编辑";
  return undefined;
}

function diffFromDetails(details: unknown): string | undefined {
  return getString(details, "diff");
}

function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (isAddedDiffLine(line)) added++;
    else if (isRemovedDiffLine(line)) removed++;
  }
  return { added, removed };
}

function diffLineClass(line: string): string {
  if (isAddedDiffLine(line)) return "added";
  if (isRemovedDiffLine(line)) return "removed";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "file";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  return "context";
}

function isAddedDiffLine(line: string): boolean {
  return line.startsWith("+") && !line.startsWith("+++");
}

function isRemovedDiffLine(line: string): boolean {
  return line.startsWith("-") && !line.startsWith("---");
}

function statusIcon(status: ToolExecutionPart["status"]): string {
  if (status === "success") return "✓";
  if (status === "error") return "✖";
  if (status === "running") return "●";
  return "○";
}

function statusLabel(status: ToolExecutionPart["status"]): string {
  if (status === "success") return "完成";
  if (status === "error") return "失败";
  if (status === "running") return "运行中";
  return "等待中";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function getString(value: unknown, key: string): string | undefined {
  const property = getProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

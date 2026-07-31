import type { WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";
import { isMarkdownDocumentPath, renderRelayDocumentHtml } from "./markdownDocument.js";
import {
  defaultRelayDocument,
  listRelayDocuments,
  listWorkspaceRelays,
  readRelayDocument,
  RELAYS_ROOT,
  type RelayDocumentContent,
  type RelayDocumentsListing,
  type RelaysListing,
} from "./relayDiscovery.js";

export const relaysPanelTagName = "pi-web-relays-panel";

export function defineRelaysPanelElement(): void {
  if (!customElements.get(relaysPanelTagName)) customElements.define(relaysPanelTagName, PiWebRelaysPanel);
}

/** Selection a scan should restore after reloading, when the entries still exist. */
interface RelaySelection {
  relayPath?: string | undefined;
  documentPath?: string | undefined;
}

/**
 * Read-only relay browser: relay picker (auto-opens a single relay), one tab
 * per relay document, and a document viewer rendering markdown documents as
 * sanitized HTML and everything else as preformatted text. All async loads
 * flow through scanToken so stale responses for a previous workspace or
 * selection never overwrite newer state.
 */
class PiWebRelaysPanel extends HTMLElement {
  private contextValue: WorkspacePanelContext | undefined;
  private listing: RelaysListing | undefined;
  private selectedRelayPath: string | undefined;
  private documents: RelayDocumentsListing | undefined;
  private selectedDocumentPath: string | undefined;
  private documentContent: RelayDocumentContent | undefined;
  private scanToken = 0;
  private readonly root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  set context(value: WorkspacePanelContext | undefined) {
    const previousKey = this.contextValue === undefined ? undefined : contextKey(this.contextValue);
    const nextKey = value === undefined ? undefined : contextKey(value);
    this.contextValue = value;
    // Parent app updates should not rescan or rebuild this shadow DOM for the
    // same workspace (mirrors the workspace-tasks panel).
    if (previousKey === nextKey) return;
    if (value === undefined) {
      this.resetScanState();
      this.render();
      return;
    }
    void this.scan(value, {});
  }

  connectedCallback(): void {
    this.render();
  }

  /** Rescan relays, then reload the selected relay's documents and the open document. */
  private async scan(context: WorkspacePanelContext, selection: RelaySelection): Promise<void> {
    const token = ++this.scanToken;
    this.resetScanState();
    this.render();

    const listing = await listWorkspaceRelays(context.files);
    if (!this.isCurrentScan(context, token)) return;
    this.listing = listing;

    // listWorkspaceRelays returns most recently modified first, so the first
    // relay is the default pre-selection.
    const relay = listing.kind === "loaded"
      ? listing.relays.find((candidate) => candidate.path === selection.relayPath) ?? listing.relays[0]
      : undefined;
    this.selectedRelayPath = relay?.path;
    if (relay === undefined) {
      this.render();
      return;
    }
    await this.loadDocuments(context, token, relay.path, selection.documentPath);
  }

  private async openRelay(context: WorkspacePanelContext, relayPath: string): Promise<void> {
    const token = ++this.scanToken;
    this.selectedRelayPath = relayPath;
    await this.loadDocuments(context, token, relayPath, undefined);
  }

  private async openDocument(context: WorkspacePanelContext, documentPath: string): Promise<void> {
    const token = ++this.scanToken;
    this.selectedDocumentPath = documentPath;
    await this.loadDocumentContent(context, token, documentPath);
  }

  private async loadDocuments(context: WorkspacePanelContext, token: number, relayPath: string, preferredDocumentPath: string | undefined): Promise<void> {
    this.documents = undefined;
    this.selectedDocumentPath = undefined;
    this.documentContent = undefined;
    this.render();

    const documents = await listRelayDocuments(context.files, relayPath);
    if (!this.isCurrentScan(context, token)) return;
    this.documents = documents;

    const document = documents.kind === "loaded"
      ? documents.documents.find((candidate) => candidate.path === preferredDocumentPath) ?? defaultRelayDocument(documents.documents)
      : undefined;
    this.selectedDocumentPath = document?.path;
    if (document === undefined) {
      this.render();
      return;
    }
    await this.loadDocumentContent(context, token, document.path);
  }

  private async loadDocumentContent(context: WorkspacePanelContext, token: number, documentPath: string): Promise<void> {
    this.documentContent = undefined;
    this.render();

    const content = await readRelayDocument(context.files, documentPath);
    if (!this.isCurrentScan(context, token)) return;
    this.documentContent = content;
    this.render();
  }

  private refresh(): void {
    const context = this.contextValue;
    if (context === undefined) return;
    void this.scan(context, { relayPath: this.selectedRelayPath, documentPath: this.selectedDocumentPath });
  }

  private resetScanState(): void {
    this.listing = undefined;
    this.selectedRelayPath = undefined;
    this.documents = undefined;
    this.selectedDocumentPath = undefined;
    this.documentContent = undefined;
  }

  private isCurrentScan(context: WorkspacePanelContext, token: number): boolean {
    return token === this.scanToken && this.contextValue !== undefined && contextKey(this.contextValue) === contextKey(context);
  }

  private render(): void {
    const context = this.contextValue;
    if (context === undefined) {
      this.root.innerHTML = `${relaysStyles()}<section class="empty">请选择工作区。</section>`;
      return;
    }
    this.root.innerHTML = `
      ${relaysStyles()}
      <section class="toolbar">
        <strong>中继</strong>
        <span class="toolbar-actions">
          ${this.renderRelayPicker()}
          <button class="icon-button" data-refresh aria-label="刷新" title="刷新">${refreshIconSvg()}</button>
        </span>
      </section>
      ${this.renderDocumentTabs()}
      <section class="viewer">${this.renderViewer()}</section>
    `;

    this.root.querySelector("button[data-refresh]")?.addEventListener("click", () => {
      this.refresh();
    });
    this.root.querySelector("select[data-relay-picker]")?.addEventListener("change", (event) => {
      const picker = event.target;
      if (picker instanceof HTMLSelectElement) void this.openRelay(context, picker.value);
    });
    for (const tab of this.root.querySelectorAll("button[data-document-path]")) {
      tab.addEventListener("click", () => {
        const documentPath = tab.getAttribute("data-document-path");
        if (documentPath !== null) void this.openDocument(context, documentPath);
      });
    }
  }

  private renderRelayPicker(): string {
    const listing = this.listing;
    if (listing?.kind !== "loaded" || listing.relays.length === 0) return "";
    // A single relay opens immediately; a one-option picker would be noise.
    if (listing.relays.length === 1) {
      const relay = listing.relays[0];
      return relay === undefined ? "" : `<span class="relay-name" title="${escapeAttr(relay.path)}">${escapeHtml(relay.name)}</span>`;
    }
    const options = listing.relays.map((relay) => {
      const selected = relay.path === this.selectedRelayPath ? " selected" : "";
      return `<option value="${escapeAttr(relay.path)}"${selected}>${escapeHtml(relay.name)}</option>`;
    }).join("");
    return `<select data-relay-picker aria-label="中继">${options}</select>`;
  }

  private renderDocumentTabs(): string {
    const documents = this.documents;
    if (documents?.kind !== "loaded" || documents.documents.length === 0) return "";
    const tabs = documents.documents.map((document) => {
      const active = document.path === this.selectedDocumentPath;
      return `<button class="document-tab${active ? " active" : ""}" data-document-path="${escapeAttr(document.path)}"${active ? ' aria-current="true"' : ""}>${escapeHtml(document.name)}</button>`;
    }).join("");
    return `<nav class="document-tabs" aria-label="中继文档">${tabs}</nav>`;
  }

  private renderViewer(): string {
    const listing = this.listing;
    if (listing === undefined) return `<p class="muted">正在扫描 ${escapeHtml(RELAYS_ROOT)}…</p>`;
    if (listing.kind === "unavailable") return renderErrorState("无法扫描工作区中继。", listing.detail);
    if (listing.kind === "missing" || listing.relays.length === 0) return renderEmptyState();
    return this.renderSelectedRelay();
  }

  private renderSelectedRelay(): string {
    const documents = this.documents;
    if (documents === undefined) return `<p class="muted">正在加载中继文档…</p>`;
    if (documents.kind === "unavailable") return renderErrorState("无法列出此中继的文档。", documents.detail);
    if (documents.kind === "missing") {
      return `<div class="empty-state"><strong>此中继已不存在。</strong><p>点击“刷新”重新扫描 ${escapeHtml(RELAYS_ROOT)}。</p></div>`;
    }
    if (documents.documents.length === 0) {
      return `
        <div class="empty-state">
          <strong>此中继还没有文档。</strong>
          <p>中继包通常包含 <code>status.md</code>、<code>charter.md</code> 和 <code>log.md</code>。</p>
        </div>
      `;
    }
    return this.renderSelectedDocument();
  }

  private renderSelectedDocument(): string {
    const documentPath = this.selectedDocumentPath;
    const content = this.documentContent;
    if (documentPath === undefined) return `<p class="muted">请选择文档。</p>`;
    if (content === undefined) return `<p class="muted">正在加载 ${escapeHtml(documentName(documentPath))}…</p>`;
    if (content.kind === "unavailable") return renderErrorState("无法读取此文档。", content.detail);
    if (content.kind === "missing") {
      return `<div class="empty-state"><strong>此文档已不存在。</strong><p>点击“刷新”重新扫描中继。</p></div>`;
    }
    if (content.binary) {
      return `<div class="empty-state"><strong>二进制文件：${escapeHtml(documentName(documentPath))}</strong><p>二进制文档无法提供文本预览。</p></div>`;
    }
    const truncation = content.truncated
      ? `<div class="status info">此文档已截断，仅显示开头内容。</div>`
      : "";
    if (isMarkdownDocumentPath(documentPath)) {
      return `${truncation}<div class="document markdown">${renderRelayDocumentHtml(content.content)}</div>`;
    }
    return `${truncation}<pre class="document">${escapeHtml(content.content)}</pre>`;
  }
}

/** Reload glyph matching the app's own refresh control (AppRefreshControl). */
function refreshIconSvg(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 6v5h-5"></path>
      <path d="M4 18v-5h5"></path>
      <path d="M18.2 9A7 7 0 0 0 6.1 6.8L4 9"></path>
      <path d="M5.8 15a7 7 0 0 0 12.1 2.2L20 15"></path>
    </svg>
  `;
}

function contextKey(context: WorkspacePanelContext): string {
  return `${context.machine.id}:${context.workspace.projectId}:${context.workspace.id}`;
}

function documentName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function renderEmptyState(): string {
  return `
    <div class="empty-state">
      <strong>此工作区中没有中继。</strong>
      <p>中继包存放在 <code>${escapeHtml(RELAYS_ROOT)}/&lt;name&gt;/</code>，此工作区目前还没有中继包。</p>
    </div>
  `;
}

function renderErrorState(message: string, detail: string): string {
  return `<div class="status error"><strong>${escapeHtml(message)}</strong><pre>${escapeHtml(detail)}</pre></div>`;
}

function relaysStyles(): string {
  return `
    <style>
      :host { display: contents; }
      /* Toolbar and tab strip are panel chrome: they must never flex-shrink
         (the app container is a fixed-height flex column; with shrink enabled
         the viewer's huge content basis starves them down to a sliver once a
         tall document renders). The viewer absorbs all shrinking instead. */
      .toolbar { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); }
      .toolbar-actions { display: inline-flex; align-items: center; flex-wrap: nowrap; justify-content: flex-end; gap: 8px; min-width: 0; }
      .relay-name { min-width: 0; color: var(--pi-text-secondary); overflow-wrap: anywhere; }
      /* Bottom padding (not viewer margin) so the gap below the tabs persists
         when the viewer's content scrolls up against its top edge. */
      .document-tabs { flex: 0 0 auto; display: flex; flex-wrap: nowrap; gap: 6px; padding: 8px 12px; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
      .viewer { flex: 1 1 auto; box-sizing: border-box; display: grid; align-content: start; gap: 12px; min-height: 0; overflow: auto; padding: 12px; }
      /* Grid children default to min-width: auto; without these caps a wide code
         block or table would silently stretch the whole viewer track. */
      .viewer > * { box-sizing: border-box; min-width: 0; max-width: 100%; }
      button, select { border: 1px solid var(--pi-border); border-radius: 7px; background: var(--pi-surface); color: var(--pi-text); font: inherit; }
      button { cursor: pointer; padding: 6px 10px; }
      button.icon-button { flex: 0 0 auto; display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; }
      button.icon-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
      select { min-width: 0; max-width: 240px; padding: 5px 6px; }
      .document-tab { flex: 0 0 auto; white-space: nowrap; font-size: 12px; padding: 4px 10px; }
      .document-tab.active { border-color: var(--pi-accent-border); background: var(--pi-accent); color: var(--pi-bg); }
      code, pre { border: 1px solid var(--pi-border-muted); border-radius: 6px; background: var(--pi-bg); color: var(--pi-text-secondary); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      code { padding: 2px 5px; }
      pre { margin: 0; overflow: auto; padding: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .document.markdown { line-height: 1.5; overflow-wrap: anywhere; }
      .document.markdown p, .document.markdown ul, .document.markdown ol, .document.markdown pre, .document.markdown blockquote, .document.markdown .table-scroll { margin: 0 0 10px; }
      .document.markdown > :last-child { margin-bottom: 0; }
      .document.markdown h1, .document.markdown h2, .document.markdown h3, .document.markdown h4 { line-height: 1.25; margin: 14px 0 8px; }
      .document.markdown h1:first-child, .document.markdown h2:first-child, .document.markdown h3:first-child, .document.markdown h4:first-child { margin-top: 0; }
      .document.markdown h1 { font-size: 18px; }
      .document.markdown h2 { font-size: 16px; }
      .document.markdown h3 { font-size: 14px; }
      .document.markdown h4 { font-size: 13px; }
      .document.markdown ul, .document.markdown ol { padding-left: 22px; }
      .document.markdown li + li { margin-top: 3px; }
      .document.markdown pre { white-space: pre; overflow-wrap: normal; }
      .document.markdown pre code { border: 0; background: transparent; padding: 0; }
      .document.markdown img { box-sizing: border-box; max-width: 100%; }
      .document.markdown blockquote { border-left: 3px solid var(--pi-border-muted); color: var(--pi-muted); padding-left: 10px; }
      .document.markdown a { color: var(--pi-accent); }
      .document.markdown .table-scroll { max-width: 100%; overflow-x: auto; }
      /* Cells wrap at word boundaries only: a wide table keeps its natural width
         and scrolls inside .table-scroll instead of being squeezed unreadably. */
      .document.markdown table { border-collapse: collapse; overflow-wrap: normal; }
      .document.markdown th, .document.markdown td { border: 1px solid var(--pi-border-muted); padding: 4px 8px; }
      .status pre { margin-top: 8px; }
      .muted { color: var(--pi-muted); }
      .empty-state { border: 1px dashed var(--pi-border-muted); border-radius: 8px; color: var(--pi-muted); padding: 12px; }
      .empty-state p { margin: 6px 0 0; }
      .status { border: 1px solid var(--pi-border); border-radius: 8px; padding: 10px; }
      .status.info { border-color: var(--pi-accent-border); background: var(--pi-bg-overlay-soft); }
      .status.error { border-color: var(--pi-danger); color: var(--pi-danger); }
      .empty { padding: 16px; color: var(--pi-muted); }
    </style>
  `;
}

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { SessionContentSearchExcerpt, SessionContentSearchMatch, SessionContentSearchResponse, SessionInfo } from "../api";
import { shortSessionId } from "../sessionLabels";

@customElement("session-search-dialog")
export class SessionSearchDialog extends LitElement {
  @property({ type: String }) query = "";
  @property({ attribute: false }) response?: SessionContentSearchResponse;
  @property({ type: Boolean }) searching = false;
  @property({ type: String }) error = "";
  @property({ attribute: false }) onSearch?: (query: string) => void;
  @property({ attribute: false }) onSelect?: (session: SessionInfo, match: SessionContentSearchMatch) => void | Promise<void>;
  @property({ attribute: false }) onClose?: () => void;
  @query("input") private searchInput?: HTMLInputElement;

  override firstUpdated(): void {
    this.searchInput?.focus();
  }

  override render(): TemplateResult {
    const hasQuery = this.query.trim() !== "";
    return html`
      <div class="backdrop" @mousedown=${() => { this.onClose?.(); }}>
        <section role="dialog" aria-modal="true" aria-label="搜索会话内容" @mousedown=${(event: MouseEvent) => { event.stopPropagation(); }} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
          <header>
            <div>
              <span class="eyebrow">会话</span>
              <h1>搜索会话内容</h1>
            </div>
            <button class="close-button" title="关闭搜索" aria-label="关闭搜索" @click=${() => { this.onClose?.(); }}>×</button>
          </header>
          <div class="body">
            <label class="search-field">
              <span aria-hidden="true">⌕</span>
              <input type="search" aria-label="搜索用户提问或 AI 回答" .value=${this.query} @input=${(event: Event) => { this.onSearch?.(inputValue(event)); }}>
              ${this.searching ? html`<span class="spinner" aria-label="正在搜索"></span>` : null}
            </label>
            ${this.renderStatus(hasQuery)}
            ${this.renderResults()}
          </div>
          <footer>
            <span>${this.resultSummary()}</span>
            <button @click=${() => { this.onClose?.(); }}>关闭</button>
          </footer>
        </section>
      </div>
    `;
  }

  private renderStatus(hasQuery: boolean): TemplateResult | null {
    if (this.error !== "") return html`<div class="status error" role="alert">搜索失败：${this.error}</div>`;
    if (!hasQuery) return null;
    if (!this.searching && this.response?.results.length === 0) return html`<div class="empty" role="status">未找到匹配内容。</div>`;
    return null;
  }

  private renderResults(): TemplateResult | null {
    const response = this.response;
    if (response === undefined || response.results.length === 0) return null;
    return html`
      <div class="results" aria-label="会话内容搜索结果">
        ${response.results.map((result) => html`
          <section class="session-group">
            <div class="session-heading">
              <strong dir="auto">${sessionLabel(result.session)}</strong>
              <span>${result.matches.length} 条匹配</span>
            </div>
            ${result.matches.map((match) => this.renderMatch(result.session, match))}
          </section>
        `)}
      </div>
    `;
  }

  private renderMatch(session: SessionInfo, match: SessionContentSearchMatch): TemplateResult {
    const role = match.role === "user" ? "用户提问" : "AI 回答";
    return html`
      <button class="match-row" @click=${() => { void this.onSelect?.(session, match); }}>
        <span class="match-meta"><span class=${`role ${match.role}`}>${role}</span></span>
        <span class="excerpts" dir="auto">
          ${match.excerpts.map((excerpt) => html`<span class="excerpt">${renderHighlightedExcerpt(excerpt)}</span>`)}
        </span>
        <span class="jump" aria-hidden="true">→</span>
      </button>
    `;
  }

  private resultSummary(): string {
    const response = this.response;
    if (response === undefined || this.query.trim() === "") return "";
    return `${String(response.matchCount)} 条消息匹配${response.truncated ? "，仅显示前 200 条" : ""}`;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.onClose?.();
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 30; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    .backdrop { box-sizing: border-box; width: 100%; height: 100dvh; display: grid; place-items: center; padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); background: var(--pi-overlay); overflow: hidden; }
    section[role="dialog"] { width: min(780px, 100%); max-height: min(760px, 100%); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); box-shadow: 0 20px 60px var(--pi-shadow-strong); overflow: hidden; }
    header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; }
    header { border-bottom: 1px solid var(--pi-border); }
    footer { min-height: 34px; border-top: 1px solid var(--pi-border); color: var(--pi-muted); }
    footer span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .body { min-height: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: 12px; padding: 16px; overflow: hidden; }
    .eyebrow { display: block; color: var(--pi-muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 20px; line-height: 1.2; }
    .search-field { box-sizing: border-box; min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 9px; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); padding: 0 11px; }
    .search-field:focus-within { border-color: var(--pi-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--pi-accent) 18%, transparent); }
    input { min-width: 0; border: 0; outline: 0; background: transparent; color: var(--pi-text); padding: 11px 0; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
    .spinner { width: 13px; height: 13px; border: 2px solid var(--pi-border); border-top-color: var(--pi-accent); border-radius: 50%; animation: spin .7s linear infinite; }
    .status, .empty { border: 1px solid var(--pi-border); border-radius: 8px; padding: 10px 12px; color: var(--pi-muted); }
    .status.error { border-color: var(--pi-danger); color: var(--pi-danger); }
    .results { min-height: 0; overflow: auto; display: grid; align-content: start; gap: 14px; padding-right: 3px; scrollbar-width: thin; }
    .session-group { display: grid; gap: 6px; }
    .session-heading { position: sticky; top: 0; z-index: 1; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 5px 2px; background: var(--pi-bg); }
    .session-heading strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-heading span { flex: none; color: var(--pi-muted); font-size: 12px; }
    .match-row { position: relative; width: 100%; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 10px 38px 10px 12px; text-align: left; cursor: pointer; }
    .match-row:hover, .match-row:focus-visible { border-color: var(--pi-accent); background: var(--pi-surface-hover); outline: 0; }
    .match-meta { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; color: var(--pi-muted); font-size: 12px; }
    .role { font-weight: 700; }
    .role.user { color: var(--pi-accent); }
    .role.assistant { color: var(--pi-success); }
    .excerpts { min-width: 0; display: grid; gap: 5px; line-height: 1.45; }
    .excerpt { overflow-wrap: anywhere; }
    mark { border-radius: 3px; background: color-mix(in srgb, var(--pi-warning, #d29922) 42%, var(--pi-warning-surface)); color: var(--pi-text-bright, var(--pi-text)); padding: 0 1px; font-weight: 700; }
    .jump { position: absolute; top: 50%; right: 13px; color: var(--pi-muted); transform: translateY(-50%); }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; font: inherit; cursor: pointer; }
    .close-button { width: 34px; height: 34px; display: grid; place-items: center; border: 0; background: transparent; color: var(--pi-muted); padding: 0; font-size: 24px; }
    .close-button:hover, .close-button:focus { color: var(--pi-text); background: var(--pi-surface-hover); }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 680px) {
      .backdrop { padding: 0; place-items: stretch; }
      section[role="dialog"] { width: 100%; height: 100dvh; max-height: none; border: 0; border-radius: 0; }
      .body { padding: 12px; }
      .match-row { padding-left: 10px; }
    }
  `;
}

export function renderHighlightedExcerpt(excerpt: SessionContentSearchExcerpt): TemplateResult {
  return html`${sessionSearchExcerptSegments(excerpt).map((segment) => segment.highlighted ? html`<mark>${segment.text}</mark>` : segment.text)}`;
}

export function sessionSearchExcerptSegments(excerpt: SessionContentSearchExcerpt): { text: string; highlighted: boolean }[] {
  const ranges = [...excerpt.matchRanges].sort((left, right) => left.start - right.start);
  const segments: { text: string; highlighted: boolean }[] = [];
  let offset = 0;
  for (const range of ranges) {
    const start = Math.max(offset, Math.min(excerpt.text.length, range.start));
    const end = Math.max(start, Math.min(excerpt.text.length, range.start + range.length));
    if (start > offset) segments.push({ text: excerpt.text.slice(offset, start), highlighted: false });
    if (end > start) segments.push({ text: excerpt.text.slice(start, end), highlighted: true });
    offset = end;
  }
  if (offset < excerpt.text.length) segments.push({ text: excerpt.text.slice(offset), highlighted: false });
  return segments;
}

function sessionLabel(session: SessionInfo): string {
  if (session.name !== undefined && session.name !== "") return session.name;
  return session.firstMessage !== "" ? session.firstMessage : shortSessionId(session.id);
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

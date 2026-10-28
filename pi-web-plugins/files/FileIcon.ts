import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { styleMap } from "lit/directives/style-map.js";

/** Alpha masks preserve file-type shapes without importing SVG markup or artwork colours. */
export class FileIcon extends LitElement {
  @property({ attribute: false }) url: string | undefined;
  @state() private failedUrl: string | undefined;
  @state() private loadedUrl: string | undefined;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("url")) {
      this.failedUrl = undefined;
      this.loadedUrl = undefined;
    }
  }

  override render(): TemplateResult {
    const url = this.url;
    const fallback = html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path></svg>`;
    if (url === undefined || url === this.failedUrl) return fallback;
    return html`
      ${this.loadedUrl === url ? html`<span class="mask" aria-hidden="true" style=${styleMap({ maskImage: `url(${JSON.stringify(url)})` })}></span>` : fallback}
      ${keyed(url, html`<img hidden crossorigin="anonymous" src=${url} alt="" referrerpolicy="no-referrer" draggable="false" @load=${() => {
        if (this.url === url) this.loadedUrl = url;
      }} @error=${() => {
        if (this.url !== url) return;
        console.warn("Failed to load file icon", url);
        this.failedUrl = url;
      }}>`)}
    `;
  }

  static override styles = css`
    :host { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; color: var(--pi-muted, currentColor); }
    .mask { display: block; width: 16px; height: 16px; background-color: currentColor; mask-size: contain; mask-repeat: no-repeat; mask-position: center; }
  `;
}

import { css, LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { writeClipboardText } from "../clipboard";
import { toSafeMarkdownHtml } from "../formatting/markdown";

const formattedTextStyles = css`
  :host { display: block; }
  .formatted { white-space: normal; overflow-wrap: anywhere; line-height: 1.45; }
  p, ul, ol, pre, blockquote, table, .code-block-wrapper { margin: 0 0 10px; }
  :is(p, ul, ol, pre, blockquote, table, .code-block-wrapper):last-child { margin-bottom: 0; }
  ul, ol { padding-left: 22px; }
  li + li { margin-top: 3px; }
  code { border: 1px solid var(--pi-border); border-radius: 4px; background: var(--pi-bg); padding: 1px 4px; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .code-block-wrapper { position: relative; }
  .code-block-wrapper pre { margin: 0; padding-right: 40px; }
  pre { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); padding: 10px; overflow-x: auto; overflow-y: hidden; }
  pre code { border: 0; padding: 0; background: transparent; }
  .code-copy-button { position: absolute; top: 6px; right: 6px; z-index: 1; display: inline-grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); padding: 0; font: 14px system-ui, sans-serif; line-height: 1; cursor: pointer; }
  .code-copy-button:hover, .code-copy-button:focus { color: var(--pi-text); border-color: var(--pi-accent); }
  blockquote { border-left: 3px solid var(--pi-border); padding-left: 10px; color: var(--pi-muted); }
  a { color: var(--pi-accent); }
  h1, h2, h3, h4 { margin: 14px 0 8px; line-height: 1.2; }
  h1:first-child, h2:first-child, h3:first-child, h4:first-child { margin-top: 0; }
  h1 { font-size: 20px; }
  h2 { font-size: 17px; }
  h3 { font-size: 15px; }
  h4 { font-size: 14px; }
  table { border-collapse: collapse; display: block; overflow-x: auto; overflow-y: hidden; }
  th, td { border: 1px solid var(--pi-border); padding: 4px 8px; }
  th { background: var(--pi-surface); }
  mark[data-search-highlight] { border-radius: 3px; background: color-mix(in srgb, var(--pi-warning) 42%, var(--pi-warning-surface)); color: var(--pi-text-bright, inherit); padding: 0 1px; box-shadow: 0 0 0 1px var(--pi-warning-border); }
`;

@customElement("formatted-text")
export class FormattedText extends LitElement {
  @property() text = "";
  @property() highlight = "";

  override render() {
    return html`<div class="formatted" dir="auto" @click=${this.onFormattedClick}>${unsafeHTML(toSafeMarkdownHtml(this.text))}</div>`;
  }

  override updated(): void {
    this.enhanceCodeBlocks();
    this.applyHighlight();
  }

  private applyHighlight(): void {
    const root = this.renderRoot.querySelector(".formatted");
    if (!(root instanceof HTMLElement)) return;
    root.querySelectorAll("mark[data-search-highlight]").forEach((mark) => {
      mark.replaceWith(document.createTextNode(mark.textContent));
    });
    root.normalize();
    const query = this.highlight.trim();
    if (query === "") return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node instanceof Text && node.parentElement?.closest(".code-copy-button") === null) textNodes.push(node);
    }
    for (const node of textNodes) highlightTextNode(node, query);
  }

  private enhanceCodeBlocks(): void {
    this.renderRoot.querySelectorAll("pre").forEach((element) => {
      if (!(element instanceof HTMLPreElement) || element.parentElement?.classList.contains("code-block-wrapper") === true) return;
      const code = element.querySelector("code");
      if (!(code instanceof HTMLElement)) return;
      const wrapper = document.createElement("div");
      wrapper.className = "code-block-wrapper";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy-button";
      button.title = "复制代码块";
      button.setAttribute("aria-label", "复制代码块");
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "⧉";
      button.append(icon);
      element.before(wrapper);
      wrapper.append(element, button);
    });
  }

  private readonly onFormattedClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest(".code-copy-button");
    if (!(button instanceof HTMLButtonElement)) return;
    const wrapper = button.closest(".code-block-wrapper");
    if (!(wrapper instanceof HTMLElement)) return;
    const code = wrapper.querySelector("pre code");
    if (!(code instanceof HTMLElement)) return;
    void this.copyCode(code.textContent, button);
  };

  private async copyCode(text: string, button: HTMLButtonElement): Promise<void> {
    const copied = await writeClipboardText(text);
    this.setCopyButtonState(button, copied ? "copied" : "failed");
    window.setTimeout(() => {
      this.setCopyButtonState(button, "idle");
    }, 1200);
  }

  private setCopyButtonState(button: HTMLButtonElement, state: "idle" | "copied" | "failed"): void {
    const icon = button.querySelector("span");
    if (icon !== null) icon.textContent = state === "copied" ? "✓" : "⧉";
    const label = state === "copied" ? "已复制代码块" : state === "failed" ? "复制代码块失败" : "复制代码块";
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  static override styles = formattedTextStyles;
}

function highlightTextNode(node: Text, query: string): void {
  const text = node.data;
  const matches = [...text.matchAll(new RegExp(escapeRegExp(query), "giu"))];
  if (matches.length === 0) return;
  let offset = 0;
  const fragment = document.createDocumentFragment();
  for (const match of matches) {
    const start = match.index;
    if (start > offset) fragment.append(text.slice(offset, start));
    const mark = document.createElement("mark");
    mark.dataset["searchHighlight"] = "";
    mark.textContent = match[0];
    fragment.append(mark);
    offset = start + match[0].length;
  }
  if (offset < text.length) fragment.append(text.slice(offset));
  node.replaceWith(fragment);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

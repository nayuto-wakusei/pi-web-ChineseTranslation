import { t } from "../i18n.js";
import { css, LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { writeClipboardText } from "../clipboard";
import type { ChatContentRendering } from "../formatting/contentRendering";
import { toSafeMarkdownHtml } from "../formatting/markdown";
import type { MarkdownWorkspaceContext, WorkspaceFileOpenRequest } from "../formatting/workspaceLinks";
import { formattedTextStyles } from "./shared";

@customElement("formatted-text")
export class FormattedText extends LitElement {
  @property() text = "";
  @property() highlight = "";
  @property() intentKey: string | undefined;
  @property({ attribute: false }) contentRendering: ChatContentRendering | undefined;
  @property({ type: Number }) contentRendererVersion = 0;
  @property() machineId = "local";
  @property({ attribute: false }) workspaceContext: MarkdownWorkspaceContext | undefined;

  override render() {
    const content = this.contentRendering?.renderMarkdown({
      text: this.text,
      machineId: this.workspaceContext?.machineId ?? this.machineId,
      toSafeHtml: (text) => toSafeMarkdownHtml(text, this.workspaceContext),
    }, this.intentKey) ?? unsafeHTML(toSafeMarkdownHtml(this.text, this.workspaceContext));
    return html`<div class="formatted" dir="auto" @click=${this.onFormattedClick}>${content}</div>`;
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
      button.title = t("ui.formattedText.copyCodeBlock", "Copy code block");
      button.setAttribute("aria-label", t("ui.formattedText.copyCodeBlock", "Copy code block"));
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
    const anchor = event.target.closest("a[data-workspace-file]");
    if (anchor instanceof HTMLAnchorElement && this.workspaceContext !== undefined
      && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
      && (!anchor.target || anchor.target === "_self")) {
      const path = anchor.getAttribute("data-workspace-file");
      if (path !== null) {
        const request = new CustomEvent<WorkspaceFileOpenRequest>("workspace-file-open", {
          detail: { ...this.workspaceContext, path }, bubbles: true, composed: true, cancelable: true,
        });
        if (!this.dispatchEvent(request)) event.preventDefault();
      }
      return;
    }
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
    const label = state === "copied" ? t("ui.formattedText.codeBlockCopied", "Code block copied") : state === "failed" ? t("ui.formattedText.failedToCopyCodeBlock", "Failed to copy code block") : t("ui.formattedText.copyCodeBlock", "Copy code block");
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  static override styles = [formattedTextStyles, css`
    mark[data-search-highlight] { border-radius: 3px; background: color-mix(in srgb, var(--pi-warning) 42%, var(--pi-warning-surface)); color: var(--pi-text-bright, inherit); padding: 0 1px; box-shadow: 0 0 0 1px var(--pi-warning-border); }
  `];
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

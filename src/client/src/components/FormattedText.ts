import { LocalizationController } from "../localization/browser";
import { formattedTextMessages as messages } from "../formattedTextMessages";
import { stylesheetIntegrationCapability } from "../plugins/styles";

import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { VisibleContentController } from "../formatting/deferredContent";
import type { ChatContentRendering } from "../formatting/contentRendering";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { writeClipboardText } from "../clipboard";
import { toSafeMarkdownHtml } from "../formatting/markdown";
import { DEFAULT_CODE_BLOCK_POLICY, type CodeBlockPolicy } from "../formatting/codeBlockPolicy";
import { rememberExternalMarkdownImageDimensions, restoreExternalMarkdownImageDimensions } from "../formatting/externalMarkdownImages";
import type { MarkdownWorkspaceContext, WorkspaceFileOpenRequest } from "../formatting/workspaceLinks";
import { formattedTextStyles } from "./formattedTextStyles";
import { codeBlockFrameStyles } from "./codeBlockFrameStyles";

const LONG_MARKDOWN_LENGTH = 4096;
const LONG_MARKDOWN_INTERVAL_MS = 80;

@customElement("formatted-text")
export class FormattedText extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
    new LocalizationController(this, undefined, () => { this.labelsDirty = true; });
  }

  @property() text = "";
  @property() highlight = "";
  @property() intentKey: string | undefined;
  @property({ type: Boolean }) imagesEnabled = true;
  @property({ attribute: false }) codeBlocks: CodeBlockPolicy = DEFAULT_CODE_BLOCK_POLICY;
  @property({ attribute: false }) contentRendering: ChatContentRendering | undefined;
  @property({ type: Number }) contentRendererVersion = 0;
  @property() machineId = "local";
  @property({ attribute: false }) workspaceContext: MarkdownWorkspaceContext | undefined;

  private readonly enhancement = new VisibleContentController(this);
  private phase: "markdown" | "preview" | "done" = "markdown";
  private scheduled = false;
  private appendOnly = false;
  private lastFormatStarted = -Infinity;
  private formatTimer: ReturnType<typeof setTimeout> | undefined;
  private markup: string | undefined;
  private content: TemplateResult | undefined;
  private displayedText = "";
  private replacing = false;
  private layoutChanged = false;
  private labelsDirty = true;
  private readonly copyStates = new WeakMap<HTMLButtonElement, "idle" | "copied" | "failed">();

  protected override willUpdate(changes: PropertyValues<this>): void {
    const inputs = ["text", "intentKey", "imagesEnabled", "codeBlocks", "contentRendering", "contentRendererVersion", "machineId", "workspaceContext"] as const;
    const changedInputs = inputs.filter((key) => changes.has(key));
    if (changedInputs.length === 0) return;
    const previousText = changes.get("text");
    this.appendOnly = changedInputs.length === 1 && typeof previousText === "string"
      && this.text.length > previousText.length && this.text.startsWith(previousText);
    if (!this.appendOnly) this.cancelFormatTimer();
    // Queued work reads the latest inputs; restarting it on each chunk can starve streaming Markdown.
    this.phase = "markdown";
    this.markup = undefined;
    // Retain stable source controls and completed previews while prose streams.
    // New identities/replacements must never show the previous content.
    this.replacing = !this.text.startsWith(this.displayedText) || changes.has("intentKey") || changes.has("machineId") || changes.has("workspaceContext");
    if (this.replacing) this.content = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.cancelFormatTimer();
    this.lastFormatStarted = -Infinity;
    super.disconnectedCallback();
    this.scheduled = false;
  }

  override render() {
    const className = this.codeBlocks.overflow === "scroll" ? "formatted code-blocks-scroll" : "formatted";
    // Source is ordinary escaped Lit text. Neither Markdown nor plugin code is
    // called by this render or by the session-loading flow. Once formatted, keep
    // that view until its update is ready: a raw tail after a Markdown block adds
    // a temporary line on every streaming chunk.
    const showSource = this.replacing || this.content === undefined;
    return html`<div class=${className} dir="auto" @load=${this.onImageLoad} @click=${this.onFormattedClick}><div class="enhanced-content" ?hidden=${this.replacing}>${this.content}</div><span class="pending-source" ?hidden=${!showSource}>${showSource ? this.text : ""}</span></div>`;
  }

  override updated(changes: PropertyValues<this>): void {
    if (this.phase !== "done" && !this.scheduled) {
      this.scheduled = true;
      this.queueEnhancement();
    }
    // HTML is memoized independently of geometry; apply hints on every DOM mount,
    // in this update's microtask before paint or the chat's position-restoration frame.
    if (this.layoutChanged) restoreExternalMarkdownImageDimensions(this.renderRoot);
    if (this.layoutChanged || changes.has("highlight")) this.applyHighlight();
    if (this.labelsDirty) {
      this.labelsDirty = false;
      // Sanitized HTML is cached independently of language. Update only owned
      // attributes, preserving source/preview DOM, focus and transient copy state.
      this.renderRoot.querySelectorAll<HTMLButtonElement>(".code-copy-button").forEach((button) => {
        this.setCopyButtonState(button, this.copyStates.get(button) ?? "idle");
      });
      this.renderRoot.querySelectorAll(".code-block-header").forEach((header) => {
        header.setAttribute("aria-label", messages.t("controls"));
      });
      this.renderRoot.querySelectorAll(".table-scroll").forEach((table) => {
        table.setAttribute("aria-label", messages.t("table"));
      });
    }
    if (this.layoutChanged) {
      this.layoutChanged = false;
      this.dispatchEvent(new CustomEvent("content-layout-changed", { bubbles: true, composed: true }));
    }
  }

  private queueEnhancement(): void {
    this.enhancement.request(() => {
      if (this.phase === "markdown" && this.appendOnly && this.content !== undefined && !this.replacing
        && this.text.length >= LONG_MARKDOWN_LENGTH) {
        const wait = this.lastFormatStarted + LONG_MARKDOWN_INTERVAL_MS - performance.now();
        if (wait > 0) {
          // One trailing timer reads the latest text even if output never pauses.
          this.formatTimer = setTimeout(() => {
            this.formatTimer = undefined;
            this.queueEnhancement();
          }, Math.ceil(wait));
          return;
        }
      }
      this.scheduled = false;
      if (this.phase === "markdown") {
        this.lastFormatStarted = performance.now();
        this.formatMarkdown();
      } else if (this.phase === "preview") this.enhanceMarkdown();
      this.requestUpdate();
    });
  }

  private cancelFormatTimer(): void {
    if (this.formatTimer === undefined) return;
    clearTimeout(this.formatTimer);
    this.formatTimer = undefined;
    this.scheduled = false;
  }

  private applyHighlight(): void {
    const root = this.renderRoot.querySelector(".enhanced-content");
    if (!(root instanceof HTMLElement)) return;
    const previous = root.querySelectorAll("mark[data-search-highlight]");
    previous.forEach((mark) => {
      mark.replaceWith(document.createTextNode(mark.textContent));
    });
    if (previous.length !== 0) root.normalize();
    const query = this.highlight.trim();
    if (query === "") return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node instanceof Text && node.parentElement?.closest(".code-copy-button") === null) textNodes.push(node);
    }
    for (const node of textNodes) highlightTextNode(node, query);
  }

  private formatMarkdown(): void {
    try {
      this.markup = toSafeMarkdownHtml(this.text, this.workspaceContext, this.intentKey, this.imagesEnabled, this.codeBlocks);
      if (this.codeBlocks.previews && this.contentRendering !== undefined) {
        this.phase = "preview";
        if (this.content === undefined) this.showMarkdown();
        else this.enhanceMarkdown();
      } else {
        this.showMarkdown();
        this.phase = "done";
      }
    } catch {
      console.warn("Chat Markdown formatting failed; source remains available");
      this.replacing = true;
      this.phase = "done";
    }
  }

  private showMarkdown(): void {
    this.labelsDirty = true;
    this.layoutChanged = true;
    this.content = html`${unsafeHTML(this.markup)}`;
    this.displayedText = this.text;
    this.replacing = false;
  }

  private enhanceMarkdown(): void {
    this.labelsDirty = true;
    try {
      this.layoutChanged = true;
      this.content = this.contentRendering?.renderMarkdown({
        text: this.text,
        machineId: this.workspaceContext?.machineId ?? this.machineId,
        toSafeHtml: (text) => text === this.text && this.markup !== undefined ? this.markup
          : toSafeMarkdownHtml(text, this.workspaceContext, this.intentKey, this.imagesEnabled, this.codeBlocks),
      }, this.intentKey, this.codeBlocks);
      this.displayedText = this.text;
      this.replacing = false;
    } catch {
      console.warn("Chat content enhancement failed; Markdown remains available");
      this.showMarkdown();
    }
    this.phase = "done";
  }

  private readonly onImageLoad = {
    // Native image loads do not bubble. Capture only inside this formatting root.
    capture: true,
    handleEvent: (event: Event): void => {
      if (event.target instanceof HTMLImageElement) rememberExternalMarkdownImageDimensions(event.target);
    },
  };

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
    const code = wrapper.querySelector("pre code, .plain-code-block");
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
    this.copyStates.set(button, state);
    const icon = button.querySelector("span");
    if (icon !== null) icon.textContent = state === "copied" ? "✓" : "⧉";
    const label = messages.t(state === "idle" ? "copy" : state);
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  static override styles = [formattedTextStyles, codeBlockFrameStyles, css`
    .pending-source { white-space: pre-wrap; overflow-wrap: anywhere; }
    .enhanced-content { display: contents; }
    .enhanced-content[hidden] { display: none; }
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

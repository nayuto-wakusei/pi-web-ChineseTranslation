import type { StylesheetIntegrationCapabilityV1 } from "@chainingintention/pi-web-cn/plugin-api";
import type { Extension } from "@codemirror/state";
import type { EditorView as CodeMirrorEditorView } from "@codemirror/view";
import { css, html, LitElement } from "lit";
import { property, query, state } from "lit/decorators.js";
import type { FilesViewerDependencies, FilesViewerLoader } from "./viewerLoader";

/** Synchronously registered shell that initializes CodeMirror only when raw code is shown. */
export class FilesCodeViewer extends LitElement {
  private integration: StylesheetIntegrationCapabilityV1 | undefined;
  private releaseStyles: (() => void) | undefined;

  @property({ attribute: false })
  get stylesheetIntegration(): StylesheetIntegrationCapabilityV1 | undefined { return this.integration; }
  set stylesheetIntegration(value: StylesheetIntegrationCapabilityV1 | undefined) {
    if (value === this.integration) return;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    this.integration = value;
    if (this.isConnected && this.renderRoot instanceof ShadowRoot) this.releaseStyles = value?.registerRoot(this.renderRoot);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.renderRoot instanceof ShadowRoot) this.releaseStyles ??= this.integration?.registerRoot(this.renderRoot);
    if (this.hasUpdated) void this.recreateEditor();
  }

  @property() content = "";
  @property() language: string | undefined;
  @property({ attribute: false }) loadViewerDependencies: FilesViewerLoader | undefined;
  @property({ attribute: false }) loadingLabel = "";
  @property({ attribute: false }) failureLabel = "";
  @query(".host") private editorHost?: HTMLDivElement;
  @state() private editorStatus: "loading" | "ready" | "failed" | "fallback" = "loading";

  private view: CodeMirrorEditorView | undefined;
  private recreateGeneration = 0;

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("content") || changed.has("language") || changed.has("loadViewerDependencies")) void this.recreateEditor();
  }

  override disconnectedCallback(): void {
    this.recreateGeneration += 1;
    this.view?.destroy();
    this.view = undefined;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    super.disconnectedCallback();
  }

  override render() {
    return html`
      <div class="host" dir="ltr" ?hidden=${this.editorStatus !== "ready"}></div>
      ${this.editorStatus === "loading" ? html`<p role="status">${this.loadingLabel}</p>` : null}
      ${this.editorStatus === "failed" ? html`<p role="alert">${this.failureLabel}</p>` : null}
      ${this.editorStatus === "failed" || this.editorStatus === "fallback" ? html`<pre dir="ltr">${this.content}</pre>` : null}
    `;
  }

  private async recreateEditor(): Promise<void> {
    const generation = ++this.recreateGeneration;
    const host = this.editorHost;
    if (!this.isConnected || host === undefined) return;
    this.view?.destroy();
    this.view = undefined;
    const load = this.loadViewerDependencies;
    if (load === undefined) { this.editorStatus = "fallback"; return; }
    this.editorStatus = "loading";
    try {
      const dependencies = await load();
      if (generation !== this.recreateGeneration) return;
      this.view = new dependencies.EditorView({
        parent: host,
        state: dependencies.EditorState.create({
          doc: this.content,
          extensions: [
            dependencies.lineNumbers(),
            dependencies.keymap.of(dependencies.defaultKeymap),
            dependencies.syntaxHighlighting(dependencies.defaultHighlightStyle, { fallback: true }),
            dependencies.EditorState.readOnly.of(true),
            dependencies.EditorView.editable.of(false),
            dependencies.EditorView.lineWrapping,
            viewerTheme(dependencies),
            ...bidiTextExtensions(dependencies, this.language),
            ...languageExtensions(dependencies, this.language),
          ],
        }),
      });
      this.editorStatus = "ready";
    } catch (error) {
      if (generation !== this.recreateGeneration) return;
      console.warn("Could not initialize the source viewer", error);
      this.editorStatus = "failed";
    }
  }

  static override styles = css`
    :host { display: block; min-height: 0; height: 100%; overflow: auto; }
    .host { height: 100%; min-height: 0; overflow: auto; }
    p, pre { margin: 8px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  `;
}

function viewerTheme(dependencies: FilesViewerDependencies): Extension {
  return dependencies.EditorView.theme({
    "&": {
      height: "100%",
      color: "var(--pi-text)",
      backgroundColor: "var(--pi-bg)",
      fontSize: "12px",
    },
    ".cm-scroller": {
      fontFamily: "var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
      lineHeight: "1.45",
    },
    ".cm-gutters": {
      backgroundColor: "var(--pi-bg)",
      color: "var(--pi-dim)",
      borderRight: "1px solid var(--pi-border-muted)",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-content": { caretColor: "transparent" },
    "&.cm-focused": { outline: "none" },
  });
}

function bidiTextExtensions(dependencies: FilesViewerDependencies, language: string | undefined): Extension[] {
  if (language !== "markdown") return [];
  return [
    dependencies.EditorView.contentAttributes.of({ dir: "auto" }),
    dependencies.EditorView.theme({
      ".cm-content": { textAlign: "start" },
      ".cm-line": { unicodeBidi: "plaintext" },
    }),
  ];
}

function languageExtensions(dependencies: FilesViewerDependencies, language: string | undefined): Extension[] {
  switch (language) {
    case undefined: return [];
    case "typescript": return [dependencies.javascriptLanguage({ typescript: true })];
    case "javascript": return [dependencies.javascriptLanguage()];
    case "json": return [dependencies.jsonLanguage()];
    case "markdown": return [dependencies.markdownLanguage()];
    case "css": return [dependencies.cssLanguage()];
    case "html": return [dependencies.htmlLanguage()];
    case "python": return [dependencies.pythonLanguage()];
    case "rust": return [dependencies.rustLanguage()];
    case "go": return [dependencies.goLanguage()];
    case "diff": return [dependencies.StreamLanguage.define(dependencies.diffLanguage)];
    default: return [];
  }
}

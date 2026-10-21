import { stylesheetIntegrationCapability } from "../plugins/styles";
import { t } from "../i18n";
import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ContentRendererContribution } from "../../../plugin-api";
import type { ContentRendererChoice } from "../plugins/contentRenderers";
import { renderIntentMemory } from "../formatting/renderIntentMemory";
import { writeClipboardText } from "../clipboard";

const COPY_SOURCE = t("ui.main.259e5385fc04", "Copy source");
const COPIED_SOURCE = t("ui.main.11c75c7531b4", "Source copied");
const COPY_FAILED = t("ui.main.0379aeb536da", "Failed to copy source");
const PREVIEW_FAILED = t("ui.main.4e1a3a974b7d", "Preview failed. Showing the original source.");

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === "object" && "then" in value && typeof value.then === "function";
}

function isTemplateResult(value: unknown): value is TemplateResult {
  return value !== null && typeof value === "object" && "_$litType$" in value;
}

/** Owns source access independently of the plugin's rendering success. */
@customElement("pi-web-content-renderer")
export class ContentRendererHost extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ type: Boolean, reflect: true, attribute: "external-controls" }) externalControls = false;
  @property() text = "";
  @property() intentKey: string | undefined;
  private restoreIntent = true;
  @property({ attribute: false }) choices: readonly ContentRendererChoice[] = [];
  @property() rendererId: string | undefined;
  @property({ type: Boolean }) allowManualPreview = false;
  @state() private manuallyActivated = false;
  @state() private selectedId: string | undefined;
  private renderer: ContentRendererContribution | undefined;
  @state() private raw = false;
  @state() private failure: string | undefined;
  @state() private copyStatus = COPY_SOURCE;
  private controller: AbortController | undefined;
  private preview: TemplateResult | undefined;

  protected override willUpdate(changes: PropertyValues<this>): void {
    const identityChanged = this.restoreIntent || changes.has("intentKey") || changes.has("text");
    const unavailable = this.selectedId !== undefined && !this.choices.some(({ id }) => id === this.selectedId);
    if (identityChanged || unavailable) {
      const intent = this.intentKey === undefined ? undefined : renderIntentMemory.read(this.intentKey, this.text, this.choices.map(({ id }) => id));
      this.selectedId = intent?.rendererId;
      this.raw = intent?.raw ?? false;
      this.manuallyActivated = intent !== undefined && !intent.raw;
      this.restoreIntent = false;
      this.renderer = undefined;
      this.cancelPreview();
    }
    const choice = this.choices.find(({ id }) => id === ((this.externalControls ? this.rendererId : undefined) ?? this.selectedId)) ?? this.choices[0];
    this.selectedId = choice?.id;
    if (changes.has("text") || this.renderer !== choice?.renderer) {
      if (!identityChanged && !unavailable) this.manuallyActivated = false;
      this.renderer = choice?.renderer;
      this.cancelPreview();
      this.failure = undefined;
      this.copyStatus = COPY_SOURCE;
    }
    if (this.externalControls) this.manuallyActivated = this.allowManualPreview;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.restoreIntent = true;
    this.manuallyActivated = false;
    this.cancelPreview();
  }

  override connectedCallback(): void {
    this.restoreIntent = true;
    super.connectedCallback();
    this.requestUpdate();
  }

  private cancelPreview(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.preview = undefined;
  }

  private remember(raw: boolean): void {
    if (this.intentKey !== undefined && this.selectedId !== undefined) {
      renderIntentMemory.choose(this.intentKey, this.text, { rendererId: this.selectedId, raw });
    }
  }

  private selectRenderer(id: string): void {
    this.selectedId = id;
    this.raw = this.raw || (!this.allowManualPreview && this.choices.find((choice) => choice.id === id)?.renderer.renderMode !== "automatic");
    this.remember(this.raw);
  }

  private setRaw(raw: boolean): void {
    this.remember(raw);
    if (this.raw === raw && (raw || (this.manuallyActivated && this.failure === undefined))) return;
    this.raw = raw;
    this.manuallyActivated = !raw;
    if (!raw) this.failure = undefined;
    this.cancelPreview();
  }

  private renderPreview(): TemplateResult | undefined {
    if (this.preview !== undefined || this.renderer === undefined || this.failure !== undefined) return this.preview;
    const controller = new AbortController();
    this.controller = controller;
    const fail = (error: unknown): void => {
      if (controller.signal.aborted || this.controller !== controller) return;
      console.warn(t("ui.main.a386d0e0ac40", "Content renderer {arg0} failed", { arg0: this.renderer?.id ?? "unknown" }), error);
      this.failure = PREVIEW_FAILED;
      this.cancelPreview();
    };
    try {
      const preview: unknown = this.renderer.render({ text: this.text, signal: controller.signal, fail });
      if (isPromiseLike(preview)) void Promise.resolve(preview).catch(fail);
      if (!isTemplateResult(preview)) throw new Error("Content renderer must return a Lit template synchronously");
      if (!controller.signal.aborted) this.preview = preview;
    } catch (error) {
      fail(error);
    }
    return this.preview;
  }

  private async copy(): Promise<void> {
    const text = this.text;
    const copied = await writeClipboardText(text);
    if (this.isConnected && text === this.text) this.copyStatus = copied ? COPIED_SOURCE : COPY_FAILED;
  }

  override render() {
    const active = this.isConnected && (this.renderer?.renderMode === "automatic" || this.allowManualPreview || this.manuallyActivated);
    if (!active) this.cancelPreview();
    const preview = !this.raw && active ? this.renderPreview() : undefined;
    const diagnostic = this.failure;
    const showingRaw = preview === undefined || diagnostic !== undefined;
    const previewLabel = this.renderer?.renderMode === "automatic" ? t("ui.sessionCleanupDialog.preview", "Preview") : t("ui.main.0d2759cbee0c", "Render");
    return html`
      ${this.externalControls ? null : html`<div class="controls" role="group" aria-label="${t("ui.main.2997468b75f1", "Diagram controls")}">
        ${this.choices.length < 2 ? null : html`
          <select aria-label="${t("ui.main.8b5bbe3ca885", "Diagram renderer")}" @change=${(event: Event) => { if (event.target instanceof HTMLSelectElement) this.selectRenderer(event.target.value); }}>
            ${this.choices.map(({ id, label }) => html`<option value=${id} .selected=${id === this.selectedId}>${label}</option>`)}
          </select>
        `}
        ${this.renderer === undefined ? null : html`
          <button type="button" aria-controls="content" aria-pressed=${!showingRaw} @click=${() => { this.setRaw(false); }}>${previewLabel}</button>
          <button type="button" aria-controls="content" aria-pressed=${showingRaw} @click=${() => { this.setRaw(true); }}>${t("ui.main.a55afe4b5fbb", "Raw")}</button>
        `}
        <button class="copy" type="button" @click=${() => { void this.copy(); }}>${this.copyStatus}</button>
        <span class="sr-only" role="status">${this.copyStatus === COPY_SOURCE ? "" : this.copyStatus}</span>
      </div>`}
      <div id="content">
        ${diagnostic === undefined ? null : html`<p role="status">${diagnostic}</p>`}
        ${showingRaw ? html`<pre tabindex="0" aria-label="${t("ui.main.109c3e711465", "Raw source")}"><code>${this.text}</code></pre>` : html`<div class="preview" tabindex="0" aria-label="${t("ui.main.c5dd50f3c2fe", "Diagram preview")}">${preview}</div>`}
      </div>
    `;
  }

  static override styles = css`
    @layer pi-web-base {
    /* Keep natural height in flex viewers: shrinking this clipping boundary
       hides content instead of giving the surrounding viewer a scroll range. */
    :host { display: block; flex-shrink: 0; margin: 0 0 10px; min-width: 0; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); overflow: hidden; color: var(--pi-text); }
    :host([external-controls]) { margin: 0; border: 0; border-radius: 0; }
    .controls { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-surface); }
    select { max-width: 100%; color: var(--pi-text); background: var(--pi-bg); border: 1px solid var(--pi-border); border-radius: 6px; padding: 3px; font: 12px/1.5 system-ui, sans-serif; }
    button { color: var(--pi-muted); background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 3px 8px; font: 12px/1.5 system-ui, sans-serif; cursor: pointer; }
    button:hover { color: var(--pi-text); background: var(--pi-bg); border-color: var(--pi-border-muted); }
    button[aria-pressed="true"] { color: var(--pi-text); background: var(--pi-bg); border-color: var(--pi-border); }
    .copy { margin-inline-start: auto; }
    :is(button, select, pre, .preview):focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    pre { overflow: auto; white-space: pre; text-align: left; direction: ltr; padding: 12px; margin: 0; }
    code { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .preview { overflow: auto; padding: 12px; }
    p { color: var(--pi-muted); margin: 0; padding: 10px 12px; font: 12px/1.5 var(--pi-font, system-ui, sans-serif); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

    }
  `;
}

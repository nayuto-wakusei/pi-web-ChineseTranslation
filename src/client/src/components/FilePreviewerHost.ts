import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { FilePreviewRenderRequest } from "../../../plugin-api";
import type { RegisteredFilePreviewer } from "../plugins/filePreviewers";
import { snapshotFilePreviewRequest } from "../plugins/filePreviewers";
import { createPluginBackend } from "../plugins/pluginPeer";
import { stylesheetIntegrationCapability } from "../plugins/styles";

function isTemplateResult(value: unknown): value is TemplateResult {
  return value !== null && typeof value === "object" && "_$litType$" in value;
}

/** The consumer owns selection and failure UI; this boundary owns plugin work. */
@customElement("pi-web-file-previewer")
export class FilePreviewerHost extends LitElement {
  @property({ attribute: false }) request: FilePreviewRenderRequest | undefined;
  @property({ attribute: false }) previewer: RegisteredFilePreviewer | undefined;
  @property({ attribute: false }) eligible: (() => boolean) | undefined;
  private controller: AbortController | undefined;
  private identity: string | undefined;
  private selected: RegisteredFilePreviewer | undefined;
  private preview: TemplateResult | undefined;
  private removeLifetimeListener: (() => void) | undefined;

  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  static override styles = css`:host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; }`;

  private cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.preview = undefined;
    this.identity = undefined;
    this.removeLifetimeListener?.();
    this.removeLifetimeListener = undefined;
  }

  override disconnectedCallback(): void {
    this.cancel();
    super.disconnectedCallback();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  protected override render(): TemplateResult {
    const request = this.request;
    const previewer = this.previewer;
    if (!this.isConnected || request === undefined || previewer === undefined || previewer.lifetime.aborted || this.eligible?.() !== true) {
      this.cancel();
      return html``;
    }
    const snapshot = snapshotFilePreviewRequest(request);
    const identity = JSON.stringify(snapshot);
    if (this.identity !== identity || this.selected !== previewer) {
      this.cancel();
      this.identity = identity;
      this.selected = previewer;
      const controller = new AbortController();
      this.controller = controller;
      const abort = () => { this.cancel(); this.requestUpdate(); };
      previewer.lifetime.addEventListener("abort", abort, { once: true });
      this.removeLifetimeListener = () => { previewer.lifetime.removeEventListener("abort", abort); };
      const fail = (error: unknown) => {
        if (controller.signal.aborted || this.controller !== controller || this.previewer !== previewer
          || this.request === undefined || JSON.stringify(snapshotFilePreviewRequest(this.request)) !== identity) return;
        this.preview = undefined;
        controller.abort();
        this.request.fail(error);
        this.requestUpdate();
      };
      try {
        const backend = createPluginBackend(previewer.binding, snapshot.machineId, controller.signal);
        const output: unknown = previewer.render(Object.freeze({ ...snapshot, files: request.files,
          ...(backend === undefined ? {} : { backend }), signal: controller.signal, fail }));
        if (!isTemplateResult(output)) {
          if (output !== null && typeof output === "object" && "then" in output && typeof output.then === "function") void Promise.resolve(output).catch(fail);
          throw new Error("File previewer render must return a synchronous Lit template");
        }
        if (!controller.signal.aborted) this.preview = output;
      } catch (error) { fail(error); }
    }
    return html`${this.preview}`;
  }
}

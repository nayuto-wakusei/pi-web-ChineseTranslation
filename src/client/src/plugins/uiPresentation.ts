import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { UiPresentationContextV1, UiPresentationRegion } from "../../../plugin-api";
import { stylesheetIntegrationCapability } from "./styles";
import type { UiPresentationRuntime } from "./uiPresentationRuntime";
export { UiPresentationRuntime } from "./uiPresentationRuntime";

const regionSlots: Readonly<Record<UiPresentationRegion, readonly string[]>> = Object.freeze({
  navigation: Object.freeze(["header", "machines", "projects", "project-resize", "workspaces", "workspace-resize", "sessions"]),
  "context-bar": Object.freeze(["content", "actions"]),
  "chat-chrome": Object.freeze(["transcript", "composer"]),
  "settings-navigation": Object.freeze(["navigation"]),
  "files-toolbar": Object.freeze([]),
});

/** A stable light-DOM boundary keeps editors/transcripts alive across presentation changes. */
@customElement("pi-web-ui-presentation")
export class UiPresentationSurface extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this, { sharedUi: true });
  }

  @property({ reflect: true }) region: UiPresentationRegion = "navigation";
  @property({ attribute: false }) runtime: UiPresentationRuntime | undefined;
  @property({ attribute: false }) context: UiPresentationContextV1 = { mode: "normal" };
  private unsubscribe: (() => void) | undefined;
  private generation = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    this.subscribeRuntime();
  }

  override disconnectedCallback(): void {
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("context") || changed.has("region") || changed.has("runtime")) this.generation++;
    if (changed.has("runtime")) this.subscribeRuntime();
  }

  private subscribeRuntime(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.runtime?.subscribe(() => { this.generation++; this.requestUpdate(); });
  }

  protected override performUpdate(): void {
    try {
      super.performUpdate();
    } catch (error) {
      if (this.runtime?.fail(this.region, error) !== true) throw error;
      this.requestUpdate();
    }
  }

  override render(): TemplateResult {
    const generation = this.generation;
    const runtime = this.runtime;
    const sourceContext = this.context;
    const region = this.region;
    const context = snapshotContext(sourceContext, () => this.isConnected && generation === this.generation && this.runtime === runtime && this.context === sourceContext && this.region === region && runtime?.isActive(region) === true);
    const slots = regionSlots[this.region];
    const presentation = runtime?.render(Object.freeze({ ...context, region: this.region, slots }));
    if (presentation !== undefined) return presentation;
    this.generation++;
    return html`${slots.map((name) => html`<slot name=${name}></slot>`)}<slot></slot>`;
  }

  static override styles = css`
    :host { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1 1 0; }
    :host([region="context-bar"]), :host([region="settings-navigation"]) { flex: 0 0 auto; }
    slot { display: contents; }
  `;
}

function snapshotContext(context: UiPresentationContextV1, current: () => boolean): UiPresentationContextV1 {
  return Object.freeze({
    mode: context.mode,
    ...(context.compact === undefined ? {} : { compact: context.compact }),
    ...(context.machine === undefined ? {} : { machine: Object.freeze({ id: context.machine.id, name: context.machine.name }) }),
    ...(context.project === undefined ? {} : { project: Object.freeze({ id: context.project.id, name: context.project.name }) }),
    ...(context.workspace === undefined ? {} : { workspace: Object.freeze({ id: context.workspace.id, label: context.workspace.label }) }),
    ...(context.session === undefined ? {} : { session: Object.freeze({ id: context.session.id, label: context.session.label }) }),
    ...(context.actions === undefined ? {} : { actions: Object.freeze(context.actions.map((action) => Object.freeze({
      id: action.id, label: action.label,
      ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
      run: () => current() && action.disabled !== true ? action.run() : undefined,
    }))) }),
  });
}

import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

export type PanelEdgeSide = "navigation" | "workspace";

@customElement("app-panel-edge-control")
export class AppPanelEdgeControl extends LitElement {
  @property({ reflect: true }) side: PanelEdgeSide = "navigation";
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property() controls = "";
  @property() expandLabel = "展开面板";
  @property() collapseLabel = "折叠面板";
  @property({ attribute: false }) onToggle?: () => void;

  override render() {
    const label = this.collapsed ? this.expandLabel : this.collapseLabel;
    return html`
      <button
        type="button"
        class="edge-button"
        title=${label}
        aria-label=${label}
        aria-controls=${this.controls}
        aria-expanded=${String(!this.collapsed)}
        @click=${() => { this.onToggle?.(); }}
      >${this.renderIcon()}</button>
    `;
  }

  private renderIcon() {
    const direction = this.iconDirection();
    const path = direction === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6";
    return html`<svg class="edge-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d=${path}/></svg>`;
  }

  private iconDirection(): "left" | "right" {
    if (this.side === "navigation") return this.collapsed ? "right" : "left";
    return this.collapsed ? "left" : "right";
  }

  static override styles = css`
    :host { min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: visible; background: var(--pi-border-muted); z-index: 2; }
    :host([side="navigation"]) { grid-column: 2; }
    :host([side="workspace"]) { grid-column: 4; }
    .edge-button { position: relative; z-index: 1; box-sizing: border-box; display: grid; place-items: center; width: 18px; height: 48px; padding: 0; border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-bg); color: var(--pi-muted); opacity: .75; cursor: pointer; }
    .edge-button:hover, .edge-button:focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); opacity: 1; }
    :host([side="navigation"][collapsed]) .edge-button { transform: translateX(calc(50% - .5px)); }
    :host([side="workspace"][collapsed]) .edge-button { transform: translateX(calc(-50% + .5px)); }
    .edge-icon { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    @media (max-width: 1180px) {
      :host([side="navigation"]) { grid-row: 1 / 3; }
      :host([side="workspace"]) { display: none; }
    }
    @media (max-width: 760px) {
      :host([side="navigation"]) { display: none; }
    }
  `;
}

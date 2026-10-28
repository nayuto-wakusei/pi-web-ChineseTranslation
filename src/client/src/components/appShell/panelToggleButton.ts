import { html } from "lit";
import { localization } from "../../localization/browser";
import { appShellMessages as m } from "../../appShellMessages";
import type { ResizablePanelSide } from "../../appShell/panelResizeController";

/** Shared native toggle for panel headers and their collapsed counterparts. */
export function renderPanelToggleButton(side: ResizablePanelSide, collapsed: boolean, onToggle: (() => void) | undefined) {
  if (onToggle === undefined) return null;

  const label = m.t(side === "navigation" ? (collapsed ? "expandNavigation" : "collapseNavigation") : (collapsed ? "expandWorkspace" : "collapseWorkspace"));
  const pointsStart = side === "navigation" ? !collapsed : collapsed;
  const pointsLeft = localization.direction === "rtl" ? !pointsStart : pointsStart;
  return html`
    <button type="button" class="panel-toggle ui-button ui-button--icon"
      data-panel-toggle=${side} title=${label} aria-label=${label}
      aria-controls=${`${side}-panel`} aria-expanded=${String(!collapsed)} @click=${onToggle}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d=${pointsLeft ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"}/></svg>
    </button>
  `;
}

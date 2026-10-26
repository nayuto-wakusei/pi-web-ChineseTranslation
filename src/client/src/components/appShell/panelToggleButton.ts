import { html } from "lit";
import { t } from "../../i18n";
import type { ResizablePanelSide } from "../../appShell/panelResizeController";

/** Shared native toggle for panel headers and their collapsed counterparts. */
export function renderPanelToggleButton(side: ResizablePanelSide, collapsed: boolean, onToggle: (() => void) | undefined) {
  if (onToggle === undefined) return null;
  const label = side === "navigation"
    ? collapsed ? t("ui.navigation.expandPanel", "Expand navigation panel") : t("ui.navigation.collapsePanel", "Collapse navigation panel")
    : collapsed ? t("ui.workspacePanel.expandPanel", "Expand workspace panel") : t("ui.workspacePanel.collapsePanel", "Collapse workspace panel");
  const pointsStart = side === "navigation" ? !collapsed : collapsed;
  const pointsLeft = typeof document !== "undefined" && document.documentElement.dir === "rtl" ? !pointsStart : pointsStart;
  return html`
    <button type="button" class="panel-toggle ui-button ui-button--icon"
      data-panel-toggle=${side} title=${label} aria-label=${label}
      aria-controls=${`${side}-panel`} aria-expanded=${String(!collapsed)} @click=${onToggle}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d=${pointsLeft ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"}/></svg>
    </button>
  `;
}

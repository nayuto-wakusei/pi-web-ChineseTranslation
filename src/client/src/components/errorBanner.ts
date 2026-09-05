import { html, type TemplateResult } from "lit";
import type { ServerNoticeSeverity } from "../../../shared/apiTypes";

/**
 * The shared application banner. Browser-local failures use the default error
 * severity; server-owned notices reuse the same presentation with their own
 * severity and dismissal callback.
 */
export function errorBanner(error: string, onDismiss: () => void, severity: ServerNoticeSeverity = "error"): TemplateResult | null {
  if (error === "") return null;
  const dismissLabel = `关闭${bannerSeverityLabel(severity)}`;
  return html`<div class=${`error ${severity}`} role="alert">
    <span class="error-text">${error}</span>
    <button type="button" class="error-dismiss" aria-label=${dismissLabel} title=${dismissLabel} @click=${() => { onDismiss(); }}>✕</button>
  </div>`;
}

function bannerSeverityLabel(severity: ServerNoticeSeverity): "信息" | "警告" | "错误" {
  if (severity === "error") return "错误";
  if (severity === "warning") return "警告";
  return "信息";
}

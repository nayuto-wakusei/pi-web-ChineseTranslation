import { t } from "../i18n";
import { html, type TemplateResult } from "lit";
import type { ServerNoticeSeverity } from "../../../shared/apiTypes";

/**
 * The shared application banner. Browser-local failures use the default error
 * severity; server-owned notices reuse the same presentation with their own
 * severity and dismissal callback.
 */
export function errorBanner(
  error: string,
  onDismiss: () => void,
  severity: ServerNoticeSeverity = "error",
  onRetry?: () => void,
): TemplateResult | null {
  if (error === "") return null;
  const dismissLabel = t("ui.main.dcf2e3223649", "Dismiss {arg0}", { arg0: bannerSeverityLabel(severity) });
  return html`<div class=${`error ${severity}`} role="alert">
    <span class="error-text">${error}</span>
    ${onRetry === undefined ? null : html`<button type="button" class="error-retry ui-button ui-button--compact" @click=${() => { onRetry(); }}>${t("ui.errorBanner.retry", "Retry")}</button>`}
    <button type="button" class="error-dismiss" aria-label=${dismissLabel} title=${dismissLabel} @click=${() => { onDismiss(); }}>✕</button>
  </div>`;
}

function bannerSeverityLabel(severity: ServerNoticeSeverity): string {
  if (severity === "error") return t("client.sessionNotifications.error.0bc1fb", "Error");
  if (severity === "warning") return t("client.sessionNotifications.warning.a8b7a4", "Warning");
  return t("bundled.info.info.e70286", "Info");
}

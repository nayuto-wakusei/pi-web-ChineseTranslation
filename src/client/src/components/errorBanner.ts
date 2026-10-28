import { localization } from "../localization/browser";
import definitions from "./errorBanner.messages";
import { html, type TemplateResult } from "lit";
import type { ServerNoticeSeverity } from "../../../shared/apiTypes";

const messages = localization.registerMessages("core.banners", definitions);
const dismissKeys = { error: "dismissError", warning: "dismissWarning", info: "dismissInfo" } as const;

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
  const dismissLabel = messages.t(dismissKeys[severity]);
  return html`<div class=${`error ${severity}`} role="alert">
    <span class="error-text">${error}</span>
    ${onRetry === undefined ? null : html`<button type="button" class="error-retry ui-button ui-button--compact" @click=${() => { onRetry(); }}>${messages.t("retry")}</button>`}
    <button type="button" class="error-dismiss" aria-label=${dismissLabel} title=${dismissLabel} @click=${() => { onDismiss(); }}>✕</button>
  </div>`;
}

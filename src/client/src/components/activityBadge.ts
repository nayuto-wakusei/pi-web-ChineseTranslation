import { html, type TemplateResult } from "lit";

export type ActivityIndicatorKind = "session" | "terminal";

export function renderActivityIndicator(kind: ActivityIndicatorKind | undefined, label = "活跃"): TemplateResult | undefined {
  if (kind === undefined) return undefined;
  return html`<span class=${`activity-indicator ${kind}`} role="img" aria-label=${label} title=${label}></span>`;
}

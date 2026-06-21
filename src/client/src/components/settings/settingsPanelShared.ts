import { css, html, type TemplateResult } from "lit";

export function renderSettingsMessages(error: string, savedMessage: string): TemplateResult | null {
  if (error !== "") return html`<div class="message error-message">${error}</div>`;
  if (savedMessage !== "") return html`<div class="message success-message">${savedMessage}</div>`;
  return null;
}

export const settingsPanelSharedStyles = css`
  :host { display: block; }
  .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
  .section-heading > div { display: grid; gap: 6px; min-width: 0; }
  h2, h3, p { margin: 0; }
  h2 { font-size: 17px; line-height: 1.25; }
  h3 { font-size: 13px; line-height: 1.3; }
  p { color: var(--pi-muted); line-height: 1.45; }
  button, input, select, textarea { font: inherit; }
  button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  button:disabled, input:disabled { opacity: .55; cursor: not-allowed; }
  .primary { border-color: var(--pi-accent); background: var(--pi-selection-bg); color: var(--pi-text-bright); }
  .secondary { flex: 0 0 auto; }
  .message, .loading-card, .config-path-card, .effective-card { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
  .message { margin-bottom: 12px; }
  .error-message { border-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); }
  .success-message { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-surface); }
  .loading-card, .config-path-card { color: var(--pi-muted); }
  .config-path-card { display: grid; gap: 5px; margin-bottom: 14px; }
  .field { display: grid; gap: 7px; }
  .field small { color: var(--pi-muted); }
  .field-heading { display: flex; align-items: center; gap: 8px; }
  .config-path-card span, .field-heading, dt { color: var(--pi-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
  code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  .override-badge { border: 1px solid var(--pi-warning-border); border-radius: 999px; color: var(--pi-warning); background: var(--pi-warning-surface); padding: 2px 7px; font-size: 11px; font-weight: 600; text-transform: none; }
  .effective-card { display: grid; gap: 10px; }
  .effective-card dl { display: grid; gap: 8px; margin: 0; }
  .effective-card dl > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; align-items: baseline; }
  dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .muted { color: var(--pi-muted); }

  @media (max-width: 760px) {
    .section-heading { display: grid; gap: 12px; }
    .section-heading .secondary { justify-self: start; }
    .effective-card dl > div { grid-template-columns: minmax(0, 1fr); gap: 3px; }
  }
`;

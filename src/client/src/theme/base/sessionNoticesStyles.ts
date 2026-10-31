import { css } from "lit";
import { uiButtonStyles } from "./controlStyles";
import { uiTranscriptStyles } from "./transcriptStyles";

export const sessionNoticesStyles = css`
  ${uiButtonStyles}
  ${uiTranscriptStyles}
  @layer pi-web-base {
  .session-warnings { display: grid; gap: 0; min-width: 0; padding: 0; }
  .session-warning { --ui-transcript-bg: var(--pi-warning-surface); --warning-colour: var(--pi-warning); position: relative; display: grid; gap: 4px; min-height: 44px; padding-block: 10px; padding-inline: 16px 44px; color: var(--pi-text); }
  .session-warning.error { --ui-transcript-bg: color-mix(in srgb, var(--pi-danger) 12%, var(--pi-surface)); --warning-colour: var(--pi-danger); }
  .session-warning.info { --ui-transcript-bg: var(--pi-selection-bg); --warning-colour: var(--pi-accent); }
  .session-warning-head { display: flex; align-items: center; gap: 8px; min-height: 16px; color: var(--warning-colour); }
  .session-warning-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .session-warning-body { min-width: 0; display: grid; gap: 3px; }
  .session-warning-message { margin: 0; overflow-wrap: anywhere; }
  .session-warning-path { margin: 0; color: var(--pi-muted); font-size: 12px; font-family: var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); overflow-wrap: anywhere; }
  .session-warning-source { min-width: 0; overflow-wrap: anywhere; color: var(--pi-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .session-warning-dismiss { position: absolute; inset-block-start: 6px; inset-inline-end: 6px; font-size: 18px; }
  }
`;

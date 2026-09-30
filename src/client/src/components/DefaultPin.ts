import { css, html, type TemplateResult } from "lit";

/** Shared native control, rendered beside a picker row rather than inside its button. */
export function defaultPin(label: string, active: boolean, disabled: boolean, onClick: () => void): TemplateResult {
  const help = active ? `${label} 已是新会话默认` : `将 ${label} 设为新会话默认`;
  return html`<button type="button" class="default-pin" aria-label=${help} title=${help}
    aria-pressed=${String(active)} ?disabled=${disabled} @click=${onClick}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill=${active ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.8">
      <path d="M12 3.2 14.7 8.7l6 .9-4.4 4.2 1 6-5.3-2.8L6.7 19.8l1-6L3.3 9.6l6-.9z" />
    </svg>
  </button>`;
}

export function defaultPinHelp(): TemplateResult {
  return html`<div class="default-help"><strong>新会话默认</strong><span>星标只影响之后新建的会话。</span></div>`;
}

export const defaultPinStyles = css`
  .default-help { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; color: var(--pi-muted); }
  .default-row { display: flex; align-items: center; border-bottom: 1px solid var(--pi-border-muted); }
  .options .default-row > button:not(.default-pin) { flex: 1; min-width: 0; width: auto; display: block; padding: 10px 12px; text-align: left; border-bottom: 0; }
  .options .default-row > button.selected { background: var(--pi-selection-bg); }
  .options button.default-pin { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 0; margin: 0 6px; border: 0; border-radius: 6px; background: transparent; color: inherit; }
  .default-pin[aria-pressed="true"] { color: var(--pi-accent); }
  .default-pin:disabled { opacity: 0.45; cursor: default; }
  .default-pin:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
`;

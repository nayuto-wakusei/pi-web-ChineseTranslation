import { t } from "../i18n";
import { css, html, type TemplateResult } from "lit";

/** Shared native control, rendered beside a picker row rather than inside its button. */
export function defaultPin(label: string, active: boolean, disabled: boolean, onClick: () => void): TemplateResult {
  const help = active ? t("ui.main.963044ce5371", "{arg0} is already the default for new sessions", { arg0: label }) : t("ui.main.10eaf2c93eb3", "Use {arg0} as the default for new sessions", { arg0: label });
  return html`<button type="button" class="default-pin ui-button ui-button--icon" aria-label=${help} title=${help}
    aria-pressed=${String(active)} ?disabled=${disabled} @click=${onClick}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill=${active ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.8">
      <path d="M12 3.2 14.7 8.7l6 .9-4.4 4.2 1 6-5.3-2.8L6.7 19.8l1-6L3.3 9.6l6-.9z" />
    </svg>
  </button>`;
}

export function defaultPinHelp(): TemplateResult {
  return html`<div class="default-help"><strong>${t("ui.main.57b11778906f", "New session default")}</strong><span>${t("ui.main.363dfe7f433e", "The star only affects newly created sessions.")}</span></div>`;
}

export const defaultPinStyles = css`
    @layer pi-web-base {
  .default-help { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; color: var(--pi-muted); }
  .default-row { display: flex; align-items: center; border-bottom: 1px solid var(--pi-border-muted); }
  .options .default-row > button:not(.default-pin) { flex: 1; min-width: 0; width: auto; display: block; padding: 10px 12px; text-align: left; border-bottom: 0; }
  .options .default-row > button.selected { background: var(--pi-selection-bg); }
  .options button.default-pin { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 0; margin: 0 6px; border: 0; border-radius: 6px; background: transparent; color: inherit; }
  .default-pin[aria-pressed="true"] { color: var(--pi-accent); }
  .default-pin:disabled { opacity: 0.45; cursor: default; }
  .default-pin:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }

    }
  `;

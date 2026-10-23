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
  .default-help { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: 8px 12px; color: var(--pi-muted); }
  .default-pin { align-self: stretch; }
  .default-pin[aria-pressed="true"] svg { color: var(--pi-accent); }

    }
  `;

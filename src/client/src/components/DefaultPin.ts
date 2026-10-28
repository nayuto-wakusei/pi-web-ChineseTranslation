import { t } from "../i18n";
import { css, html } from "lit";
import { pickerMessages as messages } from "../pickerMessages";

/** Shared native control, rendered in the picker's DOM beside (never inside) its row button. */
export function defaultPin(label: string, active: boolean, disabled: boolean, onClick: () => void) {
  const help = active ? t("ui.main.963044ce5371", "{arg0} is already the default for new sessions", { arg0: label }) : messages.t("useDefault", { label });
  return html`<button type="button" class="default-pin ui-button ui-button--icon" aria-label=${help} title=${help}
    aria-pressed=${String(active)} ?disabled=${disabled} @click=${onClick}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill=${active ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.8">
      <path d="M12 3.2 14.7 8.7l6 .9-4.4 4.2 1 6-5.3-2.8L6.7 19.8l1-6L3.3 9.6l6-.9z" />
    </svg>
  </button>`;
}

/** Evaluate at render time so picker controllers refresh this shared guidance. */
export function defaultPinHelp() {
  return html`<div class="default-help"><strong>${messages.t("defaultHelp")}</strong></div>`;
}

export const defaultPinStyles = css`
    @layer pi-web-base {
  .default-help { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: 8px 12px; color: var(--pi-muted); }
  .default-pin { align-self: stretch; }
  .default-pin[aria-pressed="true"] svg { color: var(--pi-accent); }

    }
  `;

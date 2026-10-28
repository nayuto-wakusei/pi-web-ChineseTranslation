import { stylesheetIntegrationCapability } from "../plugins/styles";
import { t } from "../i18n";

import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionStatus } from "../api";
import { formatCost, formatTokenCount } from "../utils/format";
import { renderSessionWarningIcon, statusBarStyles } from "./shared";
import { localization, LocalizationController } from "../localization/browser";
import definitions from "./statusBar.messages";

export const statusBarMessages = localization.registerMessages("core.statusBar", definitions);

export interface StatusBarWarningControlContent {
  countText: string;
  accessibleLabel: string;
}

export function statusBarWarningControlContent(count: number, expanded: boolean): StatusBarWarningControlContent | undefined {
  if (!Number.isInteger(count) || count <= 0) return undefined;
  return {
    countText: localization.number(count),
    accessibleLabel: statusBarMessages.t(expanded ? "minimizeWarnings" : "showWarnings", { count }),
  };
}

@customElement("status-bar")
export class StatusBar extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
    new LocalizationController(this);
  }

  @property({ attribute: false }) status: SessionStatus | undefined;
  @property({ type: Number }) warningCount = 0;
  @property({ type: Boolean }) warningsExpanded = false;
  @property({ attribute: false }) onToggleWarnings?: () => void;

  private readonly handleToggleWarnings = (): void => {
    this.onToggleWarnings?.();
  };

  override render() {
    const status = this.status;
    if (status === undefined) return html`<div class="bar muted">${statusBarMessages.t("empty")}</div>`;
    const context = status.contextUsage;
    const contextText = context
      ? context.percent == null
        ? statusBarMessages.t("contextSize", { size: formatTokenCount(context.contextWindow) })
        : statusBarMessages.t("contextUsage", {
          percent: localization.number(context.percent / 100, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }),
          size: formatTokenCount(context.contextWindow),
        })
      : statusBarMessages.t("contextUnknown");
    const tokens = status.tokens;
    const warningControl = statusBarWarningControlContent(this.warningCount, this.warningsExpanded);
    return html`
      <div class="bar">
        ${warningControl === undefined || this.onToggleWarnings === undefined ? null : html`
          <button
            type="button"
            class="warning-toggle"
            title=${warningControl.accessibleLabel}
            aria-label=${warningControl.accessibleLabel}
            aria-expanded=${String(this.warningsExpanded)}
            @click=${this.handleToggleWarnings}
          >
            ${renderSessionWarningIcon("warning", "warning-toggle-icon")}
            <span>${warningControl.countText}</span>
          </button>
        `}
        <span class="token-input">↑${formatTokenCount(tokens.input)}</span>
        <span class="token-output">↓${formatTokenCount(tokens.output)}</span>
        <span class="context" title=${t("ui.statusBar.contextUsage", "Context usage")}>${contextText}</span>
        <span class="cost" title=${t("ui.statusBar.sessionCost", "Session cost")}>${formatCost(status.cost)}</span>
        ${status.pendingMessageCount > 0 ? html`<span>${statusBarMessages.t("queued", { count: status.pendingMessageCount })}</span>` : null}
      </div>
    `;
  }

  static override styles = statusBarStyles;
}

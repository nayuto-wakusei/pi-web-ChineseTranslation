import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state as reactiveState } from "lit/decorators.js";
import { localization, LocalizationController } from "../localization/browser";
import { stylesheetIntegrationCapability } from "../plugins/styles";
import { uiButtonStyles } from "./ui/controlStyles";
import { uiNoticeStyles } from "./ui/noticeStyles";
import definitions from "./conversationSyncNotice.messages";

export const conversationSyncNoticeMessages = localization.registerMessages("core.conversationSyncNotice", definitions);
const messages = conversationSyncNoticeMessages;
const STALE_NOTICE_DELAY_MS = 2_000;

@customElement("conversation-sync-notice")
export class ConversationSyncNotice extends LitElement {
  constructor() {
    super();
    new LocalizationController(this);
    stylesheetIntegrationCapability.createController(this);
  }

  @property({ attribute: false }) state: "catching-up" | "checked" | "stale" | "interrupted" | undefined;
  @property({ attribute: false }) onRetry?: () => void | Promise<void>;

  @reactiveState() private showStaleWarning = false;
  private staleWarningTimer: ReturnType<typeof setTimeout> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.clearStaleWarningTimer();
    this.showStaleWarning = false;
  }

  protected override willUpdate(): void {
    if (this.state === "stale") {
      // Replacing the socket on resume is expected, not immediately a warning.
      if (!this.showStaleWarning && this.staleWarningTimer === undefined && this.isConnected) {
        this.staleWarningTimer = setTimeout(() => {
          this.staleWarningTimer = undefined;
          if (this.state === "stale") this.showStaleWarning = true;
        }, STALE_NOTICE_DELAY_MS);
      }
    } else {
      this.clearStaleWarningTimer();
      // A failed refresh is conclusive; don't delay or briefly hide its warning.
      this.showStaleWarning = this.state === "interrupted";
    }
  }

  private clearStaleWarningTimer(): void {
    if (this.staleWarningTimer !== undefined) clearTimeout(this.staleWarningTimer);
    this.staleWarningTimer = undefined;
  }

  override render() {
    if (this.state !== "interrupted" && !(this.state === "stale" && this.showStaleWarning)) return nothing;
    return html`
      <div class="ui-notice warning" role="status">
        <span>${messages.t(this.state)}</span>
        <button type="button" class="ui-button ui-button--action ui-button--compact" @click=${() => { void this.onRetry?.(); }}>${messages.t("retry")}</button>
      </div>
    `;
  }

  static override styles = [uiNoticeStyles, uiButtonStyles, css`
    :host { display: contents; }
    .ui-notice { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "conversation-sync-notice": ConversationSyncNotice;
  }
}

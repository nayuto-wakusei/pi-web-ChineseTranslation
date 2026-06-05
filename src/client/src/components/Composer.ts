import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { composerStyles } from "./shared";

@customElement("chat-composer")
export class Composer extends LitElement {
  @property({ type: Boolean }) disabled = false;
  @property({ attribute: false }) onSend?: (text: string) => void;
  @property({ attribute: false }) onStopSession?: () => void;
  @state() private draft = "";

  override render() {
    return html`
      <footer>
        <textarea
          .value=${this.draft}
          ?disabled=${this.disabled}
          @input=${(event: Event) => {
            if (event.target instanceof HTMLTextAreaElement) this.draft = event.target.value;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              this.send();
            }
          }}
          placeholder="给 pi 发送消息..."
        ></textarea>
        <button ?disabled=${this.disabled} @click=${() => { this.send(); }}>发送</button>
        <button ?disabled=${this.disabled} @click=${() => this.onStopSession?.()}>停止会话</button>
      </footer>
    `;
  }

  private send() {
    const text = this.draft.trim();
    if (text === "" || this.disabled) return;
    this.draft = "";
    this.onSend?.(text);
  }

  static override styles = composerStyles;
}

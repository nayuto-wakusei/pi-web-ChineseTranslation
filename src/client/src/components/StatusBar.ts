import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Machine, SessionStatus, Workspace } from "../api";
import type { WorkspaceLabelItem } from "../plugins/types";
import { formatCost, formatTokenCount } from "../utils/format";
import { statusBarStyles } from "./shared";
import { renderWorkspaceLabel } from "./workspaceLabel";

@customElement("status-bar")
export class StatusBar extends LitElement {
  @property({ attribute: false }) status?: SessionStatus;
  @property({ attribute: false }) machine?: Machine;
  @property({ attribute: false }) workspace?: Workspace;
  @property({ attribute: false }) workspaceLabelItems: WorkspaceLabelItem[] = [];

  override render() {
    const status = this.status;
    if (status === undefined) return html`<div class="bar muted">暂无会话状态</div>`;
    const context = status.contextUsage;
    const contextText = context
      ? context.percent == null
        ? `上下文 ${formatTokenCount(context.contextWindow)}`
        : `${context.percent.toFixed(1)}%/${formatTokenCount(context.contextWindow)}`
      : "上下文未知";
    const tokens = status.tokens;
    return html`
      <div class="bar">
        <span>${this.machine?.name ?? "本机"}</span>
        <span>${renderWorkspaceLabel(this.workspace?.label ?? "工作区", this.workspaceLabelItems, this.workspace?.path)}</span>
        <span>↑${formatTokenCount(tokens.input)}</span>
        <span>↓${formatTokenCount(tokens.output)}</span>
        <span>${contextText}</span>
        <span>${formatCost(status.cost)}</span>
        ${status.pendingMessageCount > 0 ? html`<span>${String(status.pendingMessageCount)} 条排队</span>` : null}
      </div>
    `;
  }

  static override styles = statusBarStyles;
}

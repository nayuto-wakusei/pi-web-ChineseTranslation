import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Machine, MachineHealth, WorkspaceActivity } from "../api";
import { machineActivityIndicator } from "../workspaceActivity";
import { renderActionActivityIndicator } from "./activityBadge";
import { ListMenuController } from "./ListMenuController";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { activateSelectableRow, focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles } from "./styles/listStyles";

@customElement("machine-list")
export class MachineList extends LitElement implements KeyboardNavigableSection {
  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) selected?: Machine;
  @property({ attribute: false }) statuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) activities: Record<string, Record<string, WorkspaceActivity>> = {};
  @property({ attribute: false }) unreadMachineIds: ReadonlySet<string> = new Set();
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ attribute: false }) onSelect?: (machine: Machine) => void;
  @property({ attribute: false }) onRemove?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  private readonly menu = new ListMenuController(this);

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("machines")) this.menu.closeIfOpenIdMissing((machineId) => this.machines.some((machine) => machine.id === machineId));
    if (changed.has("collapsed")) this.menu.closeIf(this.collapsed);
  }

  async focusSelectedOrFirst(): Promise<boolean> {
    await this.updateComplete;
    return focusSelectedOrFirstSelectableRow(this.renderRoot, { fallbackSelector: ".section-toggle" });
  }

  override render() {
    return html`
      <section>
        <h2>${this.renderHeading()}</h2>
        ${this.collapsed ? null : html`
          <div class="list-body">
            ${this.machines.map((machine) => this.renderMachine(machine))}
          </div>
        `}
      </section>
    `;
  }

  private renderMachine(machine: Machine) {
    const status = this.statuses[machine.id]?.status ?? machine.status ?? "unknown";
    const statusLabel = status === "online" ? "在线" : status === "offline" ? "离线" : status === "error" ? "错误" : "未知";
    const hasRemoveAction = canRemoveMachine(machine) && this.onRemove !== undefined;
    return html`
      <div
        class=${`action-row machine-row ${this.selected?.id === machine.id ? "selected" : ""} ${hasRemoveAction ? "" : "no-actions"}`}
        tabindex="0"
        title=${machine.baseUrl ?? machine.name}
        @click=${(event: MouseEvent) => { activateSelectableRow(event, () => this.onSelect?.(machine)); }}
        @keydown=${(event: KeyboardEvent) => { this.handleMachineKeydown(event, machine); }}
      >
        <div class="action-main">
          <span class="action-name machine-primary">${this.renderActivity(machine)}<span class="machine-primary-label">${machine.name}</span></span><small>${machine.kind === "local" ? "本机 PI WEB" : machine.baseUrl ?? "远程 PI WEB"} · ${statusLabel}</small>
        </div>
        ${hasRemoveAction ? this.renderMachineMenu(machine) : null}
      </div>
    `;
  }

  private renderActivity(machine: Machine) {
    const status = this.statuses[machine.id]?.status ?? machine.status;
    const kind = status === "offline" || status === "error" ? undefined : machineActivityIndicator(this.activities[machine.id]);
    const unreadLabel = this.unreadMachineIds.has(machine.id) ? "此机器上有未读会话" : undefined;
    return renderActionActivityIndicator(kind, kind === "terminal" ? "机器终端活动中" : "机器活动中", unreadLabel);
  }

  private renderMachineMenu(machine: Machine) {
    const open = this.menu.isOpen(machine.id);
    const menuId = machineMenuId(machine.id);
    return html`
      <div class="action-menu">
        <button
          class="action-menu-toggle"
          title="机器操作"
          aria-label=${`${machine.name} 的操作`}
          aria-expanded=${String(open)}
          aria-controls=${menuId}
          @click=${(event: MouseEvent) => { event.stopPropagation(); this.menu.toggle(machine.id, event.currentTarget); }}
        >⋯</button>
        ${open ? html`
          <div class="action-menu-panel machine-menu-panel" id=${menuId} style=${this.menu.menuStyle} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
            <button class="danger" title=${`移除 ${machine.name}`} @click=${() => { this.removeMachine(machine); }}>移除</button>
          </div>
        ` : null}
      </div>
    `;
  }

  private renderHeading() {
    if (!this.collapsible) return "机器";
    const selectedSummary = this.selected?.name ?? "未选择机器";
    const selectedTitle = this.selected?.baseUrl ?? selectedSummary;
    return html`<button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} 机器</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count">${this.machines.length}</small></button>`;
  }

  private removeMachine(machine: Machine): void {
    this.menu.close();
    void this.onRemove?.(machine);
  }

  private handleMachineKeydown(event: KeyboardEvent, machine: Machine): void {
    if (this.menu.closeForEscape(event, machine.id)) return;
    handleSelectableRowKeyboard(event, {
      activate: () => this.onSelect?.(machine),
      nextSection: this.onFocusNextSection === undefined ? undefined : () => { void this.onFocusNextSection?.(); },
      cancel: this.onCancelKeyboardNavigation === undefined ? undefined : () => { void this.onCancelKeyboardNavigation?.(); },
    });
  }

  static override styles = [
    listStyles,
    css`
      .machine-row.no-actions .action-main { border-radius: 8px; }
      .machine-primary { display: flex; align-items: baseline; gap: 6px; }
      .machine-primary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .machine-menu-panel button.danger { color: var(--pi-danger); }
      .machine-menu-panel button.danger:hover, .machine-menu-panel button.danger:focus { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
    `,
  ];
}

export function canRemoveMachine(machine: Machine): boolean {
  return machine.kind === "remote";
}

function machineMenuId(machineId: string): string {
  return `machine-menu-${machineId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

import { localization, LocalizationController } from "../localization/browser";
import { machineMessages as messages } from "../machineMessages";
import { stylesheetIntegrationCapability } from "../plugins/styles";
import { t } from "../i18n";
import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Machine, MachineHealth, WorkspaceActivity } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { machineActivityIndicator } from "../workspaceActivity";
import { hasStatusUnread, renderActionActivityIndicator, statusActivityKind } from "./activityBadge";
import { ListMenuController } from "./ListMenuController";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { activateSelectableRow, focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles } from "./shared";
import { sidebarListStyles } from "./sidebarListStyles";

@customElement("machine-list")
export class MachineList extends LitElement implements KeyboardNavigableSection {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
    new LocalizationController(this);
  }

  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) selected?: Machine;
  @property({ attribute: false }) statuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) activities: Record<string, Record<string, WorkspaceActivity>> = {};
  @property({ attribute: false }) unreadMachineIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) statusSnapshots: Record<string, MachineStatusSnapshot> = {};
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ attribute: false }) onSelect?: (machine: Machine) => void;
  @property({ attribute: false }) onEdit?: (machine: Machine) => void;
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
        <h2 class="ui-toolbar">${this.renderHeading()}</h2>
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
    const statusLabel = messages.t(status);
    const hasRemoveAction = canRemoveMachine(machine) && (this.onRemove !== undefined || this.onEdit !== undefined);
    return html`
      <div
        class=${`action-row machine-row ${this.selected?.id === machine.id ? "selected" : ""} ${hasRemoveAction ? "" : "no-actions"}`}
        tabindex="0"
        title=${machine.baseUrl ?? machine.name}
        data-machine-id=${machine.id}
        @click=${(event: MouseEvent) => { activateSelectableRow(event, () => this.onSelect?.(machine)); }}
        @keydown=${(event: KeyboardEvent) => { this.handleMachineKeydown(event, machine); }}
      >
        <div class="action-main">
          <span class="action-name machine-primary"><span class="machine-primary-label"><bdi>${machine.name}</bdi></span></span><small>${messages.t("subtitle", { location: machine.kind === "local" ? messages.t("local") : machine.baseUrl ?? messages.t("remote"), status: statusLabel })}</small>
          ${this.renderActivity(machine)}
        </div>
        ${hasRemoveAction ? this.renderMachineMenu(machine) : null}
      </div>
    `;
  }

  private renderActivity(machine: Machine) {
    const status = this.statuses[machine.id]?.status ?? machine.status;
    const snapshot = this.statusSnapshots[machine.id];
    const flags = snapshot?.machine;
    const kind = status === "offline" || status === "error" ? undefined : (snapshot === undefined ? machineActivityIndicator(this.activities[machine.id]) : statusActivityKind(flags));
    const unreadLabel = snapshot === undefined ? (this.unreadMachineIds.has(machine.id) ? t("ui.machineSwitcher.unreadSessionsOnThisMachine", "Unread sessions on this machine") : undefined) : (hasStatusUnread(flags) ? t("ui.machineSwitcher.unreadSessionsOnThisMachine", "Unread sessions on this machine") : undefined);
    return renderActionActivityIndicator(kind, kind === "terminal" ? t("ui.machineSwitcher.machineTerminalActive", "Machine terminal active") : t("ui.machineSwitcher.machineActive", "Machine active"), unreadLabel);
  }

  private renderMachineMenu(machine: Machine) {
    const open = this.menu.isOpen(machine.id);
    const menuId = machineMenuId(machine.id);
    return html`
      <div class="action-menu">
        <button
          class="ui-button ui-button--icon action-menu-toggle"
          title=${messages.t("actions")}
          aria-label=${messages.t("actionsFor", { name: machine.name })}
          aria-expanded=${String(open)}
          aria-controls=${menuId}
          @click=${(event: MouseEvent) => { event.stopPropagation(); this.menu.toggle(machine.id, event.currentTarget); }}
        >⋯</button>
        ${open ? html`
          <div popover="auto" class="action-menu-panel machine-menu-panel ui-menu" id=${menuId} style=${this.menu.menuStyle} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
            ${this.onEdit === undefined ? null : html`<button class="ui-button ui-menu-item" @click=${() => { this.menu.close(); this.onEdit?.(machine); }}>${messages.t("edit")}</button>`}
            ${this.onRemove === undefined ? null : html`<button class="danger ui-button ui-menu-item" title=${messages.t("removeNamed", { name: machine.name })} @click=${() => { this.removeMachine(machine); }}>${messages.t("remove")}</button>`}
          </div>
        ` : null}
      </div>
    `;
  }

  private renderHeading() {
    if (!this.collapsible) return html`<span>${messages.t("machines")}</span>`;
    const selectedSummary = this.selected?.name ?? messages.t("noSelection");
    const selectedTitle = this.selected?.baseUrl ?? selectedSummary;
    return html`<button class="ui-button ui-toolbar-title section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} ${messages.t("machines")}</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count">${localization.number(this.machines.length)}</small></button>`;
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
    sidebarListStyles,
    css`
    @layer pi-web-base {
      .machine-primary { display: flex; align-items: baseline; gap: 6px; }
      .machine-primary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }

    }
  `,
  ];
}

export function canRemoveMachine(machine: Machine): boolean {
  return machine.kind === "remote";
}

function machineMenuId(machineId: string): string {
  return `machine-menu-${machineId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

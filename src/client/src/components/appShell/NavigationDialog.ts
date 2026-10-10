import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { scrollWhenSelected } from "../scrollWhenSelected";
import { isNavigationPinned, toggleNavigationPin, type NavigationPreferences } from "../../navigationPreferences";
import type { AppMobileMainTab } from "./AppMobileMainTabs";
import "../ModalSurface";

@customElement("navigation-dialog")
export class NavigationDialog extends LitElement {
  @property({ attribute: false }) tabs: AppMobileMainTab[] = [];
  @property({ attribute: false }) pinUniverse?: readonly string[];
  @property({ attribute: false }) preferences: NavigationPreferences = { pinnedIds: [], mobileCollapsed: false };
  @property({ attribute: false }) selectedTab?: string;
  @property({ attribute: false }) onSelect?: (id: AppMobileMainTab["id"]) => void;
  @property({ attribute: false }) onPreferencesChange?: (preferences: NavigationPreferences) => void;
  @property({ attribute: false }) onClose?: () => void;

  @state() private query = "";
  @state() private selectedIndex = 0;

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("selectedTab")) this.selectedIndex = Math.max(0, this.filteredTabs().findIndex((tab) => tab.id === this.selectedTab));
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredTabs().length - 1));
  }

  private filteredTabs(): AppMobileMainTab[] {
    const query = this.query.trim().toLocaleLowerCase();
    return this.tabs.filter((tab) => tab.label.toLocaleLowerCase().includes(query));
  }

  private select(tab: AppMobileMainTab): void {
    this.onSelect?.(tab.id);
    this.onClose?.();
  }

  override render() {
    const tabs = this.filteredTabs();
    return html`
      <modal-surface .label=${"导航"} .initialFocus=${"input"} .onClose=${this.onClose} @keydown=${this.navigateDestinations}>
        <header>
          <input aria-label="搜索导航目标" aria-describedby="navigation-selection" placeholder="搜索导航目标…" .value=${this.query} @input=${(event: Event) => {
            if (event.target instanceof HTMLInputElement) {
              this.query = event.target.value;
              this.selectedIndex = 0;
            }
          }}>
          <button type="button" aria-label="关闭导航" title="关闭" @click=${this.onClose}>×</button>
        </header>
        <span id="navigation-selection" class="sr-only" role="status" aria-live="polite" aria-atomic="true">${tabs.length === 0 ? "没有匹配的导航目标。" : `${tabs[this.selectedIndex]?.label ?? ""}，第 ${String(this.selectedIndex + 1)} 项，共 ${String(tabs.length)} 项`}</span>
        <h2>导航</h2>
        <nav aria-label="导航目标">
          ${tabs.length === 0 ? html`<div class="empty">没有匹配的导航目标。</div>` : nothing}
          ${tabs.map((tab, index) => {
            const pinned = isNavigationPinned(tab.id, this.preferences.pinnedIds);
            return html`
              <div class="destination">
                <button type="button" class=${`destination-button ${index === this.selectedIndex ? "selected" : ""}`} aria-current=${tab.id === this.selectedTab ? "page" : nothing} aria-pressed=${String(tab.id === this.selectedTab)} ${scrollWhenSelected(index === this.selectedIndex, tab.id)} @focus=${() => { this.selectedIndex = index; }} @click=${() => { this.select(tab); }}>${tab.label}</button>
                <button type="button" class="pin-button" aria-label=${pinned ? `取消固定：${tab.label}` : `固定：${tab.label}`} title=${pinned ? "取消固定" : "固定到标签栏"} aria-pressed=${String(pinned)} @click=${() => {
                  this.onPreferencesChange?.({ ...this.preferences, pinnedIds: toggleNavigationPin(tab.id, this.preferences.pinnedIds, this.pinUniverse ?? this.tabs.map((item) => item.id)) });
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill=${pinned ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M8 3h8l-1 7 4 4v2H5v-2l4-4-1-7Z"></path><path d="M12 16v6"></path>
                  </svg>
                </button>
              </div>
            `;
          })}
        </nav>
        <footer>
          <button type="button" @click=${() => { this.onPreferencesChange?.({ ...this.preferences, pinnedIds: [] }); }}>显示全部标签</button>
          <div class="mobile-navigation" role="group" aria-label="移动导航显示方式">
            <span>移动导航</span>
            <button type="button" aria-pressed=${String(!this.preferences.mobileCollapsed)} @click=${() => { this.onPreferencesChange?.({ ...this.preferences, mobileCollapsed: false }); }}>展开</button>
            <button type="button" aria-pressed=${String(this.preferences.mobileCollapsed)} @click=${() => { this.onPreferencesChange?.({ ...this.preferences, mobileCollapsed: true }); }}>折叠</button>
          </div>
        </footer>
      </modal-surface>
    `;
  }

  private readonly navigateDestinations = (event: KeyboardEvent): void => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof HTMLInputElement) {
      const tabs = this.filteredTabs();
      switch (event.key) {
        case "ArrowDown": this.selectedIndex = tabs.length > 0 ? (this.selectedIndex + 1) % tabs.length : 0; break;
        case "ArrowUp": this.selectedIndex = tabs.length > 0 ? (this.selectedIndex + tabs.length - 1) % tabs.length : 0; break;
        case "Home": this.selectedIndex = 0; break;
        case "End": this.selectedIndex = Math.max(0, tabs.length - 1); break;
        case "Enter": {
          const tab = tabs[this.selectedIndex];
          if (tab !== undefined) this.select(tab);
          break;
        }
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!(event.target instanceof HTMLButtonElement)) return;
    const selector = event.target.classList.contains("pin-button") ? ".pin-button" : ".destination-button";
    const buttons = [...this.renderRoot.querySelectorAll<HTMLButtonElement>(selector)];
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    let next: number;
    switch (event.key) {
      case "ArrowDown": next = (index + 1) % buttons.length; break;
      case "ArrowUp": next = (index + buttons.length - 1) % buttons.length; break;
      case "Home": next = 0; break;
      case "End": next = buttons.length - 1; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    buttons[next]?.focus();
    buttons[next]?.scrollIntoView({ block: "nearest" });
  };

  static override styles = css`
    :host { z-index: 30; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    header, footer { flex: 0 0 auto; }
    header, footer, .destination { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    header input { flex: 1 1 auto; min-width: 0; }
    h2 { margin: 0; padding: 12px 12px 4px; font-size: 14px; }
    nav { max-height: min(50dvh, 420px); overflow: auto; overscroll-behavior: contain; }
    .destination { border-bottom: 1px solid var(--pi-border-muted); gap: 0; }
    .destination-button { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; text-align: left; padding: 10px 12px; font: inherit; font-weight: 600; }
    .destination-button.selected, .destination-button:hover { background: var(--pi-selection-bg); }
    .pin-button { display: inline-grid; place-items: center; width: 40px; height: 40px; padding: 0; }
    .pin-button[aria-pressed="true"] { color: var(--pi-accent); }
    footer { padding: 12px; border-top: 1px solid var(--pi-border); }
    footer button { padding: 7px 9px; }
    .mobile-navigation { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; }
    .mobile-navigation button[aria-pressed="true"] { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .empty { padding: 18px 12px; color: var(--pi-muted); text-align: center; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
  `;
}

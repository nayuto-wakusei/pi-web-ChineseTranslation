import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { actionMenuPanelStyle } from "../actionMenu";

const REFRESH_LONG_PRESS_MS = 550;
const REFRESH_MENU_PORTAL_STYLE_ID = "pi-web-app-refresh-menu-portal-style";

@customElement("app-refresh-control")
export class AppRefreshControl extends LitElement {
  @property({ type: Boolean }) isRefreshing = false;
  @property({ attribute: false }) onRefresh?: () => void | Promise<void>;
  @property({ attribute: false }) onReload?: () => void;
  @state() private menuOpen = false;
  private menuStyle = "";
  private menuPortal: HTMLDivElement | undefined;
  private longPressTimer: number | undefined;
  private suppressNextClick = false;

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this.onDocumentClick);
    document.addEventListener("keydown", this.onDocumentKeyDown);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("click", this.onDocumentClick);
    document.removeEventListener("keydown", this.onDocumentKeyDown);
    this.clearLongPressTimer();
    this.removePortalMenu();
    super.disconnectedCallback();
  }

  override render() {
    const label = this.isRefreshing ? "正在刷新应用数据。长按可打开重载选项。" : "刷新应用数据。长按可打开重载选项。";
    return html`
      <button
        class=${`app-refresh-button${this.isRefreshing ? " refreshing" : ""}`}
        title=${label}
        aria-label=${label}
        aria-haspopup="menu"
        aria-expanded=${String(this.menuOpen)}
        aria-busy=${String(this.isRefreshing)}
        @click=${this.onRefreshClick}
        @contextmenu=${this.onRefreshContextMenu}
        @pointerdown=${this.onRefreshPointerDown}
        @pointerup=${() => { this.clearLongPressTimer(); }}
        @pointercancel=${() => { this.clearLongPressTimer(); }}
        @pointerleave=${() => { this.clearLongPressTimer(); }}
      >${this.renderRefreshIcon()}</button>
    `;
  }

  private renderRefreshIcon() {
    return html`
      <svg class="app-refresh-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20 6v5h-5"></path>
        <path d="M4 18v-5h5"></path>
        <path d="M18.2 9A7 7 0 0 0 6.1 6.8L4 9"></path>
        <path d="M5.8 15a7 7 0 0 0 12.1 2.2L20 15"></path>
      </svg>
    `;
  }

  private readonly onRefreshClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    this.refresh();
  };

  private readonly onRefreshPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    this.clearLongPressTimer();
    this.suppressNextClick = false;
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = undefined;
      this.suppressNextClick = true;
      this.openMenu(target);
    }, REFRESH_LONG_PRESS_MS);
  };

  private readonly onRefreshContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.clearLongPressTimer();
    this.suppressNextClick = true;
    this.openMenu(event.currentTarget);
  };

  private readonly onDocumentClick = (event: MouseEvent): void => {
    const path = event.composedPath();
    if (path.includes(this) || (this.menuPortal !== undefined && path.includes(this.menuPortal))) return;
    this.closeMenu();
  };

  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.menuOpen) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeMenu();
  };

  private openMenu(target: EventTarget | null): void {
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.menuOpen = true;
    this.renderPortalMenu();
  }

  private closeMenu(): void {
    this.menuOpen = false;
    this.suppressNextClick = false;
    this.removePortalMenu();
  }

  private refresh(): void {
    this.closeMenu();
    void this.onRefresh?.();
  }

  private reload(): void {
    this.closeMenu();
    this.onReload?.();
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer === undefined) return;
    window.clearTimeout(this.longPressTimer);
    this.longPressTimer = undefined;
  }

  private renderPortalMenu(): void {
    const ownerDocument = this.ownerDocument;
    ensurePortalMenuStyles(ownerDocument);

    const menu = this.menuPortal ?? ownerDocument.createElement("div");
    this.menuPortal = menu;
    menu.className = "pi-web-app-refresh-menu-portal";
    menu.setAttribute("role", "menu");
    menu.setAttribute("style", this.menuStyle);
    menu.replaceChildren(
      this.createPortalMenuButton("刷新应用数据", () => { this.refresh(); }),
      this.createPortalMenuButton("完整重载页面", () => { this.reload(); }),
    );
    menu.addEventListener("click", this.onPortalMenuClick);
    if (!menu.isConnected) ownerDocument.body.append(menu);
  }

  private createPortalMenuButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = this.ownerDocument.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private removePortalMenu(): void {
    this.menuPortal?.removeEventListener("click", this.onPortalMenuClick);
    this.menuPortal?.remove();
    this.menuPortal = undefined;
  }

  private readonly onPortalMenuClick = (event: MouseEvent): void => {
    event.stopPropagation();
  };

  static override styles = css`
    :host { position: relative; z-index: 1; display: flex; align-items: center; pointer-events: auto; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
    :host, :host * { -webkit-user-select: none; user-select: none; }
    .app-refresh-button { box-sizing: border-box; width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--pi-border); border-radius: 999px; background: var(--pi-surface); color: var(--pi-text); padding: 0; line-height: 1; cursor: pointer; touch-action: manipulation; -webkit-touch-callout: none; }
    .app-refresh-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    .app-refresh-button.refreshing .app-refresh-icon { animation: app-refresh-spin .8s linear infinite; }
    @keyframes app-refresh-spin { to { transform: rotate(360deg); } }
  `;
}

function ensurePortalMenuStyles(ownerDocument: Document): void {
  if (ownerDocument.getElementById(REFRESH_MENU_PORTAL_STYLE_ID) !== null) return;
  const style = ownerDocument.createElement("style");
  style.id = REFRESH_MENU_PORTAL_STYLE_ID;
  style.textContent = `
    .pi-web-app-refresh-menu-portal {
      position: fixed;
      z-index: 2147483647;
      box-sizing: border-box;
      min-width: min(170px, calc(100vw - 16px));
      overflow: auto;
      padding: 4px;
      border: 1px solid var(--pi-border);
      border-radius: 8px;
      background: var(--pi-surface);
      color: var(--pi-text);
      box-shadow: 0 8px 24px var(--pi-shadow);
      overflow-wrap: anywhere;
      font: 14px system-ui, sans-serif;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
    }
    .pi-web-app-refresh-menu-portal button {
      display: block;
      width: 100%;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--pi-text);
      padding: 7px 9px;
      text-align: left;
      white-space: normal;
      overflow-wrap: anywhere;
      font: inherit;
      cursor: pointer;
    }
    .pi-web-app-refresh-menu-portal button:hover,
    .pi-web-app-refresh-menu-portal button:focus {
      background: var(--pi-selection-bg);
    }
  `;
  ownerDocument.head.append(style);
}

import { css, LitElement, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { AppAction } from "../actions";
import { formatShortcut } from "../keyboardShortcuts";
import { scrollWhenSelected } from "./scrollWhenSelected";

const actionPaletteStyles = css`
  :host { position: fixed; inset: 0; z-index: 20; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  .backdrop { --palette-top: min(12dvh, 90px); --palette-bottom: max(20px, env(safe-area-inset-bottom)); display: grid; align-items: start; justify-items: center; width: 100%; height: 100dvh; background: var(--pi-overlay); padding: var(--palette-top) 20px var(--palette-bottom); box-sizing: border-box; overflow: hidden; }
  section { width: min(720px, 100%); max-height: min(640px, calc(100dvh - var(--palette-top) - var(--palette-bottom))); display: flex; flex-direction: column; border: 1px solid var(--pi-border); border-radius: 12px; background: var(--pi-bg); box-shadow: 0 20px 60px var(--pi-shadow-strong); overflow: hidden; }
  header { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 10px; border-bottom: 1px solid var(--pi-border); }
  input { min-width: 0; border: 0; outline: none; background: transparent; color: var(--pi-text); font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); padding: 8px; }
  input::placeholder { color: var(--pi-dim); }
  button { border: 0; background: transparent; color: var(--pi-text); cursor: pointer; }
  header button { color: var(--pi-muted); font-size: 22px; padding: 2px 8px; }
  .options { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .options button { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 12px; width: 100%; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); text-align: left; }
  .options button.selected, .options button:hover { background: var(--pi-selection-bg); }
  .main { min-width: 0; }
  strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { display: block; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .group { grid-column: 1 / -1; font-size: 12px; }
  kbd { align-self: center; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); padding: 2px 6px; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
  .empty { padding: 24px; color: var(--pi-muted); text-align: center; }
`;

@customElement("action-palette")
export class ActionPalette extends LitElement {
  @property({ attribute: false }) actions: AppAction[] = [];
  @property({ attribute: false }) onRun?: (action: AppAction) => void;
  @property({ attribute: false }) onCancel?: () => void;
  @query("input") private input?: HTMLInputElement;
  @state() private queryText = "";
  @state() private selectedIndex = 0;

  override render() {
    const actions = this.filteredActions();
    return html`
      <div class="backdrop" @mousedown=${() => this.onCancel?.()}>
        <section @mousedown=${(event: MouseEvent) => { event.stopPropagation(); }} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
          <header>
            <input
              .value=${this.queryText}
              placeholder="搜索操作..."
              @input=${(event: Event) => {
                if (event.target instanceof HTMLInputElement) {
                  this.queryText = event.target.value;
                  this.selectedIndex = 0;
                }
              }}
            >
            <button title="关闭" @click=${() => this.onCancel?.()}>×</button>
          </header>
          <div class="options">
            ${actions.length === 0 ? html`<div class="empty">未找到操作。</div>` : actions.map((action, index) => html`
              <button class=${`${index === this.selectedIndex ? "selected" : ""} ${action.enabled === false ? "disabled" : ""}`} ?disabled=${action.enabled === false} title=${action.disabledReason ?? action.title} ${scrollWhenSelected(index === this.selectedIndex, action.id)} @click=${() => { this.run(action); }}>
                <span class="main">
                  <strong>${action.title}</strong>
                  ${action.description !== undefined && action.description !== "" ? html`<small>${action.description}</small>` : null}
                  ${action.enabled === false && action.disabledReason !== undefined ? html`<small class="disabled-reason">${action.disabledReason}</small>` : null}
                </span>
                ${action.shortcut !== undefined ? html`<kbd>${formatShortcut(action.shortcut)}</kbd>` : null}
                ${action.group !== undefined && action.group !== "" ? html`<small class="group">${action.group}</small>` : null}
              </button>
            `)}
          </div>
        </section>
      </div>
    `;
  }

  override firstUpdated() {
    this.input?.focus();
  }

  protected override updated(changed: PropertyValues) {
    if (!changed.has("actions") && !changed.has("queryText")) return;
    const maxIndex = Math.max(0, this.filteredActions().length - 1);
    if (this.selectedIndex > maxIndex) this.selectedIndex = maxIndex;
  }

  private filteredActions(): AppAction[] {
    return filterActionPaletteActions(this.actions, this.queryText);
  }

  private handleKeyDown(event: KeyboardEvent) {
    const actions = this.filteredActions();
    if (event.key === "Escape") {
      event.preventDefault();
      this.onCancel?.();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (actions.length > 0) this.selectedIndex = (this.selectedIndex + 1) % actions.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (actions.length > 0) this.selectedIndex = (this.selectedIndex - 1 + actions.length) % actions.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      const action = actions[this.selectedIndex];
      if (action !== undefined) this.run(action);
    }
  }

  private run(action: AppAction) {
    if (action.enabled === false) return;
    this.onRun?.(action);
  }

  static override styles = actionPaletteStyles;
}

export function filterActionPaletteActions(actions: readonly AppAction[], queryText: string): AppAction[] {
  const query = queryText.trim().toLowerCase();
  return actions
    .filter((action) => action.enabled !== false || action.disabledReason !== undefined)
    .filter((action) => {
      if (query === "") return true;
      const haystack = [action.title, action.description ?? "", action.disabledReason ?? "", action.group ?? "", action.shortcut ?? ""].join(" ").toLowerCase();
      return haystack.includes(query);
    });
}

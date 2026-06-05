import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { AppAction } from "../../actions";
import type { PiWebConfigResponse, PiWebShortcutConfig } from "../../api";
import { formatShortcut } from "../../keyboardShortcuts";

@customElement("settings-shortcuts-panel")
export class SettingsShortcutsPanel extends LitElement {
  @property({ attribute: false }) actions: AppAction[] = [];
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;

  override render(): TemplateResult {
    const groups = shortcutGroups(this.actions);
    return html`
      <div class="section-heading">
        <div>
          <h2>键盘快捷键</h2>
          <p>查看已注册的应用操作和快捷键配置。手动配置项使用 action id，可以覆盖默认快捷键，或设置为 <code>null</code> 以禁用。</p>
        </div>
      </div>
      <div class="shortcut-note">配置键：<code>shortcuts</code>。示例：<code>{ "core:view.chat": "mod+1", "core:session.stop": null }</code></div>
      ${groups.length === 0 ? html`<div class="loading-card">没有已注册操作。</div>` : groups.map((group) => html`
        <section class="shortcut-group">
          <h3>${group.name}</h3>
          <div class="shortcut-list">
            ${group.actions.map((action) => this.renderShortcutRow(action))}
          </div>
        </section>
      `)}
    `;
  }

  private renderShortcutRow(action: AppAction): TemplateResult {
    const shortcuts = this.configResponse?.config.shortcuts;
    const configured = shortcutPreference(action.id, shortcuts);
    const shortcut = configured === null ? undefined : configured ?? action.shortcut;
    const state = shortcutState(action, shortcuts);
    return html`
      <div class="shortcut-row">
        <div class="shortcut-main">
          <strong>${action.title}</strong>
          ${action.description !== undefined && action.description !== "" ? html`<small>${action.description}</small>` : null}
          <small class="shortcut-id">${action.id}</small>
        </div>
        <div class="shortcut-value">
          ${shortcut !== undefined && shortcut !== "" ? html`<kbd>${formatShortcut(shortcut)}</kbd>` : html`<span class="unassigned">${state === "disabled" ? "已禁用" : "未分配"}</span>`}
          <small class=${state}>${shortcutStateLabel(state)}</small>
        </div>
      </div>
    `;
  }

  static override styles = css`
    :host { display: block; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
    .section-heading > div { display: grid; gap: 6px; min-width: 0; }
    h2, h3, p { margin: 0; }
    h2 { font-size: 17px; line-height: 1.25; }
    h3 { font-size: 13px; line-height: 1.3; }
    p { color: var(--pi-muted); line-height: 1.45; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .loading-card, .shortcut-note { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .loading-card, .shortcut-note { color: var(--pi-muted); }
    .shortcut-note { margin-bottom: 14px; }
    .shortcut-group { margin: 0 0 16px; }
    .shortcut-group h3 { margin: 0 0 8px; color: var(--pi-muted); font-size: 12px; text-transform: uppercase; }
    .shortcut-list { border: 1px solid var(--pi-border); border-radius: 10px; overflow: hidden; }
    .shortcut-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-surface); }
    .shortcut-row:last-child { border-bottom: 0; }
    .shortcut-main { min-width: 0; display: grid; gap: 3px; }
    .shortcut-main strong, .shortcut-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .shortcut-main small { color: var(--pi-muted); }
    .shortcut-id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .shortcut-value { justify-self: end; display: grid; justify-items: end; gap: 3px; }
    kbd { justify-self: end; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-bg); color: var(--pi-text-secondary); padding: 3px 7px; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
    .unassigned { justify-self: end; color: var(--pi-muted); font-size: 12px; }
    .shortcut-value small { color: var(--pi-muted); font-size: 11px; }
    .shortcut-value small.custom { color: var(--pi-accent); }
    .shortcut-value small.disabled { color: var(--pi-warning); }

    @media (max-width: 760px) {
      .section-heading { display: grid; gap: 12px; }
      .shortcut-row { grid-template-columns: minmax(0, 1fr); align-items: start; }
      .shortcut-value { justify-self: start; justify-items: start; }
      kbd, .unassigned { justify-self: start; }
    }
  `;
}

type ShortcutState = "default" | "custom" | "disabled" | "unassigned";

function shortcutGroups(actions: AppAction[]): { name: string; actions: AppAction[] }[] {
  const grouped = new Map<string, AppAction[]>();
  for (const action of [...actions].sort(compareActions)) {
    const group = action.group ?? "其他";
    grouped.set(group, [...(grouped.get(group) ?? []), action]);
  }
  return [...grouped.entries()].map(([name, groupActions]) => ({ name, actions: groupActions }));
}

function compareActions(left: AppAction, right: AppAction): number {
  return (left.group ?? "其他").localeCompare(right.group ?? "其他") || left.title.localeCompare(right.title);
}

function shortcutPreference(actionId: string, shortcuts: PiWebShortcutConfig | undefined): string | null | undefined {
  if (shortcuts === undefined || !Object.hasOwn(shortcuts, actionId)) return undefined;
  return shortcuts[actionId];
}

function shortcutState(action: AppAction, shortcuts: PiWebShortcutConfig | undefined): ShortcutState {
  const configured = shortcutPreference(action.id, shortcuts);
  if (configured === null) return "disabled";
  if (configured !== undefined) return "custom";
  return action.shortcut === undefined || action.shortcut === "" ? "unassigned" : "default";
}

function shortcutStateLabel(state: ShortcutState): string {
  switch (state) {
    case "default": return "默认";
    case "custom": return "配置覆盖";
    case "disabled": return "配置禁用";
    case "unassigned": return "无默认值";
  }
}

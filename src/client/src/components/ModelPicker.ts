import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { CommandOption, SessionModelCatalogEntry, SessionModelScopeMode } from "../api";
import { keyboardEventOriginatesFromNativeActivationControl } from "./keyboardEventTarget";
import "./ModalSurface";
import { scrollWhenSelected } from "./scrollWhenSelected";

export type ModelPickerMode = "enabled" | "all";

export interface ModelCatalogView {
  rows: SessionModelCatalogEntry[];
}

export function modelCatalogEntryValue(entry: Pick<SessionModelCatalogEntry, "provider" | "id">): string {
  return `${entry.provider}/${entry.id}`;
}

export function filterModelOptions(options: readonly CommandOption[], query: string): CommandOption[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return [...options];
  return options.filter((option) => `${option.label} ${option.description ?? ""} ${option.value}`.toLowerCase().includes(normalized));
}

function modelCatalogInNaturalOrder(catalog: readonly SessionModelCatalogEntry[]): SessionModelCatalogEntry[] {
  if (!catalog.every((entry) => entry.catalogIndex !== undefined)) return [...catalog];
  return [...catalog].sort((left, right) => (left.catalogIndex ?? 0) - (right.catalogIndex ?? 0));
}

export function modelCatalogView(catalog: readonly SessionModelCatalogEntry[], query: string, stableOrder?: readonly string[]): ModelCatalogView {
  const naturalRows = modelCatalogInNaturalOrder(catalog);
  const rowsByValue = new Map(naturalRows.map((entry) => [modelCatalogEntryValue(entry), entry]));
  const listed = new Set<string>();
  const orderedRows = stableOrder === undefined
    ? naturalRows
    : [
        ...stableOrder.flatMap((value) => {
          const entry = rowsByValue.get(value);
          if (entry === undefined || listed.has(value)) return [];
          listed.add(value);
          return [entry];
        }),
        ...naturalRows.filter((entry) => !listed.has(modelCatalogEntryValue(entry))),
      ];
  const normalized = query.trim().toLowerCase();
  return { rows: normalized === "" ? orderedRows : orderedRows.filter((entry) => `${entry.provider} ${entry.id} ${entry.name ?? ""}`.toLowerCase().includes(normalized)) };
}

export interface ModelCatalogToggleAllPlan {
  mode: SessionModelScopeMode;
  canApply: boolean;
  hasChanges: boolean;
}

export function modelCatalogToggleAllPlan(catalog: readonly SessionModelCatalogEntry[], currentValue: string | undefined): ModelCatalogToggleAllPlan {
  const enabledEntries = catalog.filter((entry) => entry.enabled);
  const current = currentValue === undefined ? undefined : catalog.find((entry) => modelCatalogEntryValue(entry) === currentValue);
  const onlyCurrentEnabled = current?.enabled === true && enabledEntries.length === 1;
  const mode: SessionModelScopeMode = enabledEntries.length === 0 || onlyCurrentEnabled ? "all" : "current";
  return {
    mode,
    canApply: mode === "all" || current !== undefined,
    hasChanges: mode === "all" ? enabledEntries.length < catalog.length : current !== undefined && (!current.enabled || enabledEntries.some((entry) => entry !== current)),
  };
}

interface ModelPickerRow {
  value: string;
  entry?: SessionModelCatalogEntry;
}

@customElement("model-picker")
export class ModelPicker extends LitElement {
  @property() override title = "选择模型";
  @property({ attribute: false }) options: CommandOption[] = [];
  @property({ attribute: false }) catalog: SessionModelCatalogEntry[] = [];
  @property({ attribute: false }) selectedValue?: string;
  @property({ attribute: false }) onPick?: (value: string) => void;
  @property({ attribute: false }) onCancel?: () => void;
  @property({ attribute: false }) onToggleEnabled?: (provider: string, modelId: string, enabled: boolean) => unknown;
  @property({ attribute: false }) onSetScope?: (mode: SessionModelScopeMode) => unknown;

  @state() private mode: ModelPickerMode = "enabled";
  @state() private selectedIndex = 0;
  @state() private query = "";
  @state() private pendingToggles: ReadonlySet<string> = new Set();
  @state() private toggleAllPending = false;
  private catalogOrder: string[] = [];
  private catalogScrollTopBeforeUpdate: number | undefined;
  private focusAfterToggle: HTMLElement | undefined;

  override render() {
    const rows = this.visibleRows();
    return html`
      <modal-surface .onClose=${() => this.onCancel?.()} .initialFocus=${"input.search"} .label=${this.title} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
        <header><strong>${this.title}</strong><button aria-label="关闭" @click=${() => this.onCancel?.()}>×</button></header>
        <div class="scope-toggle" role="group" aria-label="模型范围">
          ${this.renderScopeToggleButton("enabled", "已启用")}
          ${this.renderScopeToggleButton("all", "全部模型")}
        </div>
        ${!this.modelScopeEditable ? html`
          <div class="scope-notice" role="status">
            <strong>项目覆盖</strong>
            <span>当前工作区的 <code>.pi/settings.json</code> 控制模型可用性，无法在此修改。</span>
          </div>
        ` : nothing}
        <div class="search-row">
          <input class="search" aria-label="搜索模型" placeholder="搜索" .value=${this.query} @input=${(event: Event) => { this.handleSearchInput(event); }}>
          ${this.mode === "all" ? this.renderToggleAllButton() : nothing}
        </div>
        <div class="options" role="region" aria-label=${this.mode === "all" ? "按目录顺序显示的全部模型" : "已启用模型"} tabindex="0" aria-busy=${this.membershipChangePending ? "true" : "false"}>
          ${this.mode === "all" ? this.renderCatalogList() : this.renderEnabledList()}
          ${rows.length === 0 ? html`<div class="empty">没有匹配选项</div>` : null}
        </div>
      </modal-surface>
    `;
  }

  override firstUpdated() {
    this.anchorSelectionToSelectedValue();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("catalog")) return;
    if (this.mode === "all") this.catalogScrollTopBeforeUpdate = this.shadowRoot?.querySelector<HTMLElement>(".options")?.scrollTop;
    this.rememberCatalogOrder();
    if (this.mode !== "all") return;
    const previousCatalog = changed.get("catalog");
    if (previousCatalog === undefined) return;
    const previousRows = modelCatalogView(previousCatalog, this.query, this.catalogOrder).rows;
    const anchored = previousRows[this.selectedIndex];
    const rows = modelCatalogView(this.catalog, this.query, this.catalogOrder).rows;
    const anchoredValue = anchored === undefined ? undefined : modelCatalogEntryValue(anchored);
    const nextIndex = anchoredValue === undefined ? -1 : rows.findIndex((entry) => modelCatalogEntryValue(entry) === anchoredValue);
    this.selectedIndex = nextIndex >= 0 ? nextIndex : Math.min(this.selectedIndex, Math.max(rows.length - 1, 0));
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has("catalog") || this.catalogScrollTopBeforeUpdate === undefined) return;
    const options = this.shadowRoot?.querySelector<HTMLElement>(".options");
    if (options !== null && options !== undefined) options.scrollTop = this.catalogScrollTopBeforeUpdate;
    this.catalogScrollTopBeforeUpdate = undefined;
  }

  private get membershipChangePending(): boolean {
    return this.toggleAllPending || this.pendingToggles.size > 0;
  }

  private get modelScopeEditable(): boolean {
    return this.catalog.every((entry) => entry.editable !== false);
  }

  private renderScopeToggleButton(mode: ModelPickerMode, label: string): TemplateResult {
    return html`<button ?disabled=${this.membershipChangePending} aria-pressed=${this.mode === mode ? "true" : "false"} @click=${() => { this.selectMode(mode); }}>${label}</button>`;
  }

  private renderToggleAllButton(): TemplateResult {
    const plan = modelCatalogToggleAllPlan(this.catalog, this.selectedValue);
    const label = plan.mode === "all" ? "全选" : "除当前模型外全部取消";
    return html`
      <button class="toggle-all" ?disabled=${!this.modelScopeEditable || !plan.canApply || !plan.hasChanges || this.toggleAllPending || this.pendingToggles.size > 0} aria-describedby="model-scope-status" title=${!this.modelScopeEditable ? "工作区设置控制模型可用性" : !plan.canApply ? "当前模型不可用" : nothing} @click=${() => { this.requestToggleAll(); }}>${label}</button>
      <span id="model-scope-status" class="scope-status" aria-live="polite">${this.membershipChangePending ? "正在更新模型可用性" : !this.modelScopeEditable ? "工作区设置控制模型可用性" : !plan.canApply ? "当前模型不可用" : nothing}</span>
    `;
  }

  private rememberCatalogOrder(): void {
    const knownCatalogValues = new Set(this.catalogOrder);
    for (const entry of modelCatalogView(this.catalog, "").rows) {
      const value = modelCatalogEntryValue(entry);
      if (knownCatalogValues.has(value)) continue;
      knownCatalogValues.add(value);
      this.catalogOrder.push(value);
    }
  }

  private renderEnabledList(): TemplateResult[] {
    return filterModelOptions(this.options, this.query).map((option, index) => html`
      <button class=${index === this.selectedIndex ? "selected" : ""} ?disabled=${this.membershipChangePending} aria-current=${index === this.selectedIndex ? "true" : nothing} ${scrollWhenSelected(index === this.selectedIndex, option.value)} @focus=${() => { this.selectedIndex = index; }} @click=${() => this.onPick?.(option.value)}>
        <span>${option.label}</span>
        ${option.description !== undefined && option.description !== "" ? html`<small>${option.description}</small>` : null}
      </button>
    `);
  }

  private renderCatalogList(): TemplateResult {
    const rows = modelCatalogView(this.catalog, this.query, this.catalogOrder).rows;
    return html`${repeat(rows, modelCatalogEntryValue, (entry, index) => this.renderCatalogRow(entry, index))}`;
  }

  private renderCatalogRow(entry: SessionModelCatalogEntry, index: number): TemplateResult {
    const value = modelCatalogEntryValue(entry);
    const selected = index === this.selectedIndex;
    const protectsCurrentModel = value === this.selectedValue && entry.enabled;
    const membershipDisabled = !this.modelScopeEditable || this.membershipChangePending || protectsCurrentModel;
    const membershipLabel = !this.modelScopeEditable ? `${value} 的模型可用性由工作区设置控制` : protectsCurrentModel ? `不能取消当前模型 ${value}` : `${entry.enabled ? "禁用" : "启用"} ${value}`;
    return html`
      <div class="catalog-row ${selected ? "selected" : ""}" data-model-value=${value} ${scrollWhenSelected(selected, value)}>
        <input type="checkbox" .checked=${entry.enabled} ?disabled=${membershipDisabled} aria-label=${membershipLabel} title=${!this.modelScopeEditable ? "工作区设置控制模型可用性" : protectsCurrentModel ? "当前模型必须保持启用" : nothing} @focus=${() => { this.selectedIndex = index; }} @click=${(event: MouseEvent) => { this.handleEnableToggleClick(entry, event); }} />
        <button class="membership" ?disabled=${membershipDisabled} aria-label=${membershipLabel} aria-current=${value === this.selectedValue ? "true" : nothing} @focus=${() => { this.selectedIndex = index; }} @click=${(event: MouseEvent) => { this.requestEnabledToggle(entry, event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined); }}>
          <span>${entry.id}${value === this.selectedValue ? " ✓ 当前" : ""}</span><small>${entry.provider}</small>
        </button>
      </div>
    `;
  }

  private visibleRows(): ModelPickerRow[] {
    if (this.mode === "all") return modelCatalogView(this.catalog, this.query, this.catalogOrder).rows.map((entry) => ({ value: modelCatalogEntryValue(entry), entry }));
    return filterModelOptions(this.options, this.query).map((option) => ({ value: option.value }));
  }

  private anchorSelectionToSelectedValue(): void {
    if (this.selectedValue === undefined) {
      this.selectedIndex = 0;
      return;
    }
    const index = this.visibleRows().findIndex((row) => row.value === this.selectedValue);
    this.selectedIndex = index >= 0 ? index : 0;
  }

  private selectMode(mode: ModelPickerMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.anchorSelectionToSelectedValue();
  }

  private handleSearchInput(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.query = event.target.value;
      this.selectedIndex = 0;
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const focusedCheckbox = event.composedPath().find((target): target is HTMLInputElement => target instanceof HTMLInputElement && target.type === "checkbox");
    if (focusedCheckbox !== undefined) {
      if (event.key === "Enter") {
        event.preventDefault();
        focusedCheckbox.click();
      }
      return;
    }
    if (keyboardEventOriginatesFromNativeActivationControl(event)) return;
    if (this.membershipChangePending && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      return;
    }
    const rows = this.visibleRows();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rows.length > 0) this.selectedIndex = (this.selectedIndex + 1) % rows.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length > 0) this.selectedIndex = (this.selectedIndex - 1 + rows.length) % rows.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[this.selectedIndex];
      if (row?.entry !== undefined) this.requestEnabledToggle(row.entry);
      else if (row !== undefined) this.onPick?.(row.value);
    } else if (event.key === " " && this.mode === "all") {
      if (event.composedPath().some((target) => target instanceof HTMLInputElement)) return;
      const row = rows[this.selectedIndex];
      if (row?.entry === undefined) return;
      event.preventDefault();
      this.requestEnabledToggle(row.entry);
    }
  }

  private handleEnableToggleClick(entry: SessionModelCatalogEntry, event: MouseEvent): void {
    event.preventDefault();
    const checkbox = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined;
    if (checkbox !== undefined) checkbox.checked = entry.enabled;
    this.requestEnabledToggle(entry, checkbox);
  }

  private requestEnabledToggle(entry: SessionModelCatalogEntry, focusTarget?: HTMLElement): void {
    const value = modelCatalogEntryValue(entry);
    if (!this.modelScopeEditable || (value === this.selectedValue && entry.enabled) || this.membershipChangePending) return;
    if (focusTarget !== undefined && this.shadowRoot?.activeElement === focusTarget) this.focusAfterToggle = focusTarget;
    const pending = new Set(this.pendingToggles);
    pending.add(value);
    this.pendingToggles = pending;
    void this.settleEnabledToggle(value, entry);
  }

  private requestToggleAll(): void {
    if (!this.modelScopeEditable || this.toggleAllPending || this.pendingToggles.size > 0) return;
    const plan = modelCatalogToggleAllPlan(this.catalog, this.selectedValue);
    if (!plan.canApply || !plan.hasChanges) return;
    this.toggleAllPending = true;
    void this.settleToggleAll(plan.mode);
  }

  private async settleToggleAll(mode: SessionModelScopeMode): Promise<void> {
    try {
      await this.onSetScope?.(mode);
    } catch (error: unknown) {
      console.warn(`Failed to ${mode === "all" ? "enable all models" : "keep only the current model"}`, error);
    } finally {
      this.toggleAllPending = false;
    }
  }

  private async settleEnabledToggle(value: string, entry: SessionModelCatalogEntry): Promise<void> {
    try {
      await this.onToggleEnabled?.(entry.provider, entry.id, !entry.enabled);
    } catch (error: unknown) {
      console.warn(`Failed to toggle model ${value}`, error);
    } finally {
      const settled = new Set(this.pendingToggles);
      settled.delete(value);
      this.pendingToggles = settled;
      const focusTarget = this.focusAfterToggle;
      this.focusAfterToggle = undefined;
      await this.updateComplete;
      if (focusTarget?.isConnected === true && this.shadowRoot?.activeElement === null) focusTarget.focus({ preventScroll: true });
    }
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 10; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    modal-surface { --modal-surface-width: min(720px, calc(100vw - 40px)); --modal-surface-max-height: min(640px, calc(100vh - 40px)); }
    header { display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid var(--pi-border); }
    .scope-toggle { display: flex; gap: 4px; margin: 10px 12px 0; padding: 3px; border: 1px solid var(--pi-border); border-radius: 8px; }
    .scope-toggle button { flex: 1; padding: 6px 10px; border-radius: 6px; color: var(--pi-muted); }
    .scope-toggle button[aria-pressed="true"] { background: var(--pi-selection-bg); color: var(--pi-text); }
    .scope-notice { display: grid; gap: 3px; margin: 10px 12px 0; padding: 8px 10px; border: 1px solid var(--pi-border); border-radius: 8px; color: var(--pi-muted); }
    .scope-notice strong, .scope-notice code { color: var(--pi-text); }
    .scope-notice code { font: inherit; }
    .options { min-height: 0; overflow: auto; outline: none; }
    button { border: 0; background: transparent; color: var(--pi-text); cursor: pointer; }
    header button { font-size: 20px; color: var(--pi-muted); }
    .search-row { display: flex; align-items: center; gap: 8px; margin: 10px 12px; }
    input.search { flex: 1; min-width: 0; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); padding: 8px 10px; outline: none; }
    input.search:focus { border-color: var(--pi-accent); }
    .toggle-all { flex: none; padding: 8px 10px; border: 1px solid var(--pi-border); border-radius: 8px; white-space: nowrap; }
    .toggle-all:hover:not(:disabled) { background: var(--pi-selection-bg); }
    .toggle-all:disabled { cursor: default; opacity: 0.55; }
    .scope-status { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .options > button { display: block; width: 100%; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); text-align: left; }
    .options > button.selected, .options > button:hover { background: var(--pi-selection-bg); }
    .catalog-row { display: flex; align-items: center; border-bottom: 1px solid var(--pi-border-muted); }
    .catalog-row.selected, .catalog-row:hover { background: var(--pi-selection-bg); }
    .catalog-row input[type="checkbox"] { margin: 0 0 0 12px; accent-color: var(--pi-accent); }
    .catalog-row .membership { flex: 1; min-width: 0; display: block; padding: 10px 12px; text-align: left; }
    small { display: block; margin-top: 4px; color: var(--pi-muted); }
    .empty { padding: 24px; color: var(--pi-muted); text-align: center; }
  `;
}

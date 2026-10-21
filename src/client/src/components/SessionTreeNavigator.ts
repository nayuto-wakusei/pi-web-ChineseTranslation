import { t } from "../i18n.js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionTreeNavigateResult, SessionTreeNodeKind, SessionTreeSnapshot, SessionTreeSummaryChoice } from "../api";
import { SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH } from "../../../shared/apiTypes";
import { buildSessionTreeModel, initialSessionTreeSelection, toggleSessionTreeFold, transitionSessionTreeKey, validateSessionTreeSummaryChoice, visibleSessionTreeRows, type SessionTreeModel, type SessionTreeRow } from "../sessionTreeModel";

const EMPTY_TREE: SessionTreeSnapshot = { nodes: [], activeLeafId: null, activePathIds: [] };
const MAX_SESSION_TREE_VISUAL_DEPTH = 8;
type NavigatorStep = "tree" | "confirm";
type PendingFocus = "tree" | "summary" | "custom";

@customElement("session-tree-navigator")
export class SessionTreeNavigator extends LitElement {
  @property({ attribute: false }) tree: SessionTreeSnapshot = EMPTY_TREE;
  @property({ attribute: false }) onNavigate?: (targetId: string, summaryChoice: SessionTreeSummaryChoice) => Promise<SessionTreeNavigateResult>;
  @property({ attribute: false }) onAbort?: () => Promise<void>;
  @property({ attribute: false }) onCancel?: () => void;

  @state() private selectedId: string | undefined;
  @state() private foldedIds: ReadonlySet<string> = new Set();
  @state() private step: NavigatorStep = "tree";
  @state() private summaryMode: SessionTreeSummaryChoice["mode"] = "none";
  @state() private customInstructions = "";
  @state() private busy = false;
  @state() private aborting = false;
  @state() private error = "";
  @state() private statusMessage = "";

  private model: SessionTreeModel = buildSessionTreeModel(EMPTY_TREE);
  private pendingFocus: PendingFocus | undefined;
  private operationGeneration = 0;

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("tree")) this.resetTree();
  }

  protected override updated(): void {
    const pendingFocus = this.pendingFocus;
    if (pendingFocus === undefined) return;
    this.pendingFocus = undefined;
    if (pendingFocus === "tree") this.focusSelectedTreeItem();
    else if (pendingFocus === "custom") this.renderRoot.querySelector<HTMLTextAreaElement>("#session-tree-custom-focus")?.focus();
    else this.renderRoot.querySelector<HTMLInputElement>("input[name='session-tree-summary']:checked")?.focus();
  }

  override render(): TemplateResult {
    return html`
      <div class="backdrop" @mousedown=${(event: MouseEvent) => { this.handleBackdropMouseDown(event); }}>
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-tree-heading"
          aria-busy=${this.busy ? "true" : "false"}
          tabindex="-1"
          @mousedown=${(event: MouseEvent) => { event.stopPropagation(); }}
          @keydown=${(event: KeyboardEvent) => { this.handleDialogKeyDown(event); }}
        >
          <header>
            <div>
              <span class="eyebrow">${t("ui.sessionTreeNavigator.conversationHistory", "Conversation history")}</span>
              <h1 id="session-tree-heading">${t("ui.sessionTreeNavigator.browseSessionTree", "Browse session tree")}</h1>
            </div>
            <button class="close-button" ?disabled=${this.busy} title=${t("ui.sessionTreeNavigator.closeSessionTree", "Close session tree")} aria-label=${t("ui.sessionTreeNavigator.closeSessionTree", "Close session tree")} @click=${() => { this.onCancel?.(); }}>×</button>
          </header>
          ${this.step === "tree" ? this.renderTreeStep() : this.renderConfirmationStep()}
          ${this.renderFooter()}
        </section>
      </div>
    `;
  }

  private renderTreeStep(): TemplateResult {
    const rows = visibleSessionTreeRows(this.model, this.foldedIds);
    return html`
      <div class="body tree-step">
        <div class="tree-intro">
          <p>${t("ui.sessionTreeNavigator.chooseWhereToContinueTheConversationContextAll", "Choose where to continue the conversation context. All retained branches stay in this session file.")}</p>
          <div class="legend" aria-label=${t("ui.sessionTreeNavigator.sessionTreeMarkers", "Session tree markers")}>
            <span><span class="marker active-path-marker" aria-hidden="true"></span>${t("ui.sessionTreeNavigator.activePath", "Active path")}</span>
            <span><span class="marker active-leaf-marker" aria-hidden="true"></span>${t("ui.sessionTreeNavigator.activeLeaf", "Active leaf")}</span>
          </div>
        </div>
        ${this.statusMessage === "" ? null : html`<div class="dialog-status" role="status">${this.statusMessage}</div>`}
        ${this.error === "" ? null : html`<div class="dialog-error" role="alert">${this.error}</div>`}
        ${rows.length === 0 ? html`
          <div class="empty" role="status">${t("ui.sessionTreeNavigator.thisSessionContainsNoSelectableHistoryEntries", "This session contains no selectable history entries.")}</div>
        ` : html`
          <div class="tree" role="tree" aria-label=${t("ui.sessionTreeNavigator.fullSessionHistory", "Full session history")}>
            ${rows.map((row) => this.renderTreeRow(row))}
          </div>
        `}
      </div>
    `;
  }

  private renderTreeRow(row: SessionTreeRow): TemplateResult {
    const selected = row.node.id === this.selectedId;
    const expanded = row.childIds.length > 0 && !this.foldedIds.has(row.node.id);
    const classes = [
      "tree-row",
      selected ? "selected" : "",
      row.activePath ? "active-path" : "",
      row.activeLeaf ? "active-leaf" : "",
      isBookkeepingKind(row.node.kind) ? "bookkeeping" : "",
    ].filter((value) => value !== "").join(" ");
    const visualDepth = sessionTreeVisualDepth(row.branchDepth);
    return html`
      <div
        class=${classes}
        style=${`--tree-indent: ${String(visualDepth * 16)}px; --tree-indent-mobile: ${String(visualDepth * 12)}px;`}
        role="treeitem"
        aria-level=${String(row.depth + 1)}
        aria-selected=${selected ? "true" : "false"}
        aria-expanded=${row.childIds.length === 0 ? nothing : expanded ? "true" : "false"}
        aria-current=${row.activeLeaf ? "true" : nothing}
        tabindex=${selected ? "0" : "-1"}
        data-tree-node-id=${row.node.id}
        @click=${() => { this.selectNode(row.node.id); }}
        @keydown=${(event: KeyboardEvent) => { this.handleTreeKeyDown(event); }}
      >
        <span
          class=${`disclosure${row.childIds.length === 0 ? " leaf" : ""}`}
          title=${row.childIds.length === 0 ? t("ui.sessionTreeNavigator.noChildEntries", "No child entries") : expanded ? t("ui.sessionTreeNavigator.collapseBranch", "Collapse branch") : t("ui.sessionTreeNavigator.expandBranch", "Expand branch")}
          aria-hidden="true"
          @click=${(event: MouseEvent) => { this.toggleNode(row.node.id, event); }}
        >${row.childIds.length === 0 ? "·" : expanded ? "▾" : "▸"}</span>
        <span class="metadata">
          <span class="kind">${sessionTreeKindLabel(row.node.kind)}</span>
          <span class="badges">
            ${row.activePath && !row.activeLeaf ? html`<span class="badge path">${t("ui.sessionTreeNavigator.activePath", "Active path")}</span>` : null}
            ${row.activeLeaf ? html`<span class="badge leaf">${t("ui.sessionTreeNavigator.activeLeaf", "Active leaf")}</span>` : null}
          </span>
        </span>
        <span class="entry">
          <span class="summary" dir="auto">${row.node.summary}</span>
          ${row.node.label === undefined ? null : html`<span class="label" title=${row.node.label}>${row.node.label}</span>`}
          ${row.node.timestamp === undefined ? null : html`<time datetime=${row.node.timestamp}>${row.node.timestamp}</time>`}
        </span>
      </div>
    `;
  }

  private renderConfirmationStep(): TemplateResult {
    const selectedNode = this.selectedId === undefined ? undefined : this.model.nodesById.get(this.selectedId);
    const validation = validateSessionTreeSummaryChoice(this.summaryMode, this.customInstructions);
    return html`
      <div class="body confirmation-step">
        <div class="confirmation-card">
          <div>
            <span class="eyebrow">${t("ui.sessionTreeNavigator.selectedEntry", "Selected entry")}</span>
            <h2>${t("ui.sessionTreeNavigator.confirmNavigation", "Confirm navigation")}</h2>
          </div>
          ${selectedNode === undefined ? html`<div class="empty">${t("ui.sessionTreeNavigator.theSelectedHistoryEntryIsNoLongerAvailable", "The selected history entry is no longer available.")}</div>` : html`
            <div class="selected-entry">
              <span class="kind">${sessionTreeKindLabel(selectedNode.kind)}</span>
              <strong dir="auto">${selectedNode.summary}</strong>
              ${sessionTreeEntryReturnsToEditor(selectedNode.kind)
                ? html`<p>${t("ui.sessionTreeNavigator.thisMessageSTextReturnsToThePrompt", "This message's text returns to the prompt editor for optional editing and resubmission.")}</p>`
                : html`<p>${t("ui.sessionTreeNavigator.thePromptEditorWillBeEmptyAfterNavigating", "The prompt editor will be empty after navigating to this entry.")}</p>`}
            </div>
          `}
          <fieldset ?disabled=${this.busy}>
            <legend>${t("ui.sessionTreeNavigator.abandonedBranchSummary", "Abandoned branch summary")}</legend>
            ${this.renderSummaryOption("none", t("ui.sessionTreeNavigator.skipSummary", "Skip summary"), t("ui.sessionTreeNavigator.switchBranchesWithoutAddingASummaryEntry", "Switch branches without adding a summary entry."))}
            ${this.renderSummaryOption("default", t("ui.sessionTreeNavigator.generateSummary", "Generate summary"), t("ui.sessionTreeNavigator.askPiToSummarizeTheContextYouAre", "Ask Pi to summarize the context you are leaving."))}
            ${this.renderSummaryOption("custom", t("ui.sessionTreeNavigator.summarizeWithCustomFocus", "Summarize with custom focus"), t("ui.sessionTreeNavigator.guidePiTowardDetailsRelevantToTheNew", "Guide Pi toward details relevant to the new branch."))}
            ${this.summaryMode === "custom" ? html`
              <label class="custom-focus" for="session-tree-custom-focus">
                <span>${t("ui.sessionTreeNavigator.customSummaryFocus", "Custom summary focus")}</span>
                <textarea
                  id="session-tree-custom-focus"
                  rows="5"
                  maxlength=${String(SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH)}
                  .value=${this.customInstructions}
                  @input=${(event: InputEvent) => { this.handleCustomInstructionsInput(event); }}
                ></textarea>
                <span class="character-count">${this.customInstructions.length} / ${SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH}</span>
              </label>
              ${validation.ok ? null : html`<div class="validation-error" role="alert">${validation.error}</div>`}
            ` : null}
          </fieldset>
          <div class="side-effects-note" role="note">
            <strong>${t("ui.sessionTreeNavigator.onlyConversationContextIsAffected", "Only conversation context is affected.")}</strong>${t("ui.sessionTreeNavigator.navigationChangesTheActiveConversationBranchButDoes", "Navigation changes the active conversation branch but does not undo filesystem changes, terminal commands, tool calls, or other side effects.")}
          </div>
          ${this.statusMessage === "" ? null : html`<div class="dialog-status" role="status">${this.statusMessage}</div>`}
          ${this.error === "" ? null : html`<div class="dialog-error" role="alert">${this.error}</div>`}
        </div>
      </div>
    `;
  }

  private renderSummaryOption(mode: SessionTreeSummaryChoice["mode"], label: string, description: string): TemplateResult {
    return html`
      <label class=${`summary-option${this.summaryMode === mode ? " selected" : ""}`}>
        <input
          type="radio"
          name="session-tree-summary"
          value=${mode}
          .checked=${this.summaryMode === mode}
          @change=${() => { this.selectSummaryMode(mode); }}
        >
        <span><strong>${label}</strong><small>${description}</small></span>
      </label>
    `;
  }

  private renderFooter(): TemplateResult {
    if (this.step === "tree") {
      return html`
        <footer>
          <button @click=${() => { this.onCancel?.(); }}>${t("ui.sessionTreeNavigator.cancel", "Cancel")}</button>
          <button class="primary" ?disabled=${this.selectedId === undefined} @click=${() => { this.continueToConfirmation(); }}>${t("ui.sessionTreeNavigator.navigate", "Navigate")}</button>
        </footer>
      `;
    }

    const summarizing = this.summaryMode !== "none";
    return html`
      <footer>
        <button ?disabled=${this.busy} @click=${() => { this.returnToTree(); }}>${t("ui.sessionTreeNavigator.back", "Back")}</button>
        <span class="footer-spacer"></span>
        ${this.busy && summarizing ? html`
          <button class="danger" ?disabled=${this.aborting} @click=${() => { void this.abortNavigation(); }}>${this.aborting ? t("ui.sessionTreeNavigator.cancelling", "Cancelling…") : t("ui.sessionTreeNavigator.cancelSummary", "Cancel summary")}</button>
        ` : null}
        <button class="primary" ?disabled=${this.busy || this.selectedId === undefined} @click=${() => { void this.submitNavigation(); }}>
          ${this.busy ? summarizing ? t("ui.sessionTreeNavigator.summarizing", "Summarizing…") : t("ui.sessionTreeNavigator.navigating", "Navigating…") : summarizing ? t("ui.sessionTreeNavigator.summarizeAndNavigate", "Summarize and navigate") : t("ui.sessionTreeNavigator.navigate", "Navigate")}
        </button>
      </footer>
    `;
  }

  private resetTree(): void {
    this.operationGeneration += 1;
    this.model = buildSessionTreeModel(this.tree);
    this.selectedId = initialSessionTreeSelection(this.model);
    this.foldedIds = new Set();
    this.step = "tree";
    this.summaryMode = "none";
    this.customInstructions = "";
    this.busy = false;
    this.aborting = false;
    this.error = "";
    this.statusMessage = "";
    this.pendingFocus = "tree";
  }

  private selectNode(id: string): void {
    if (!this.model.nodesById.has(id)) return;
    this.selectedId = id;
    this.error = "";
    this.statusMessage = "";
    this.pendingFocus = "tree";
  }

  private toggleNode(id: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const next = toggleSessionTreeFold(this.model, { selectedId: this.selectedId, foldedIds: this.foldedIds }, id);
    this.selectedId = next.selectedId;
    this.foldedIds = next.foldedIds;
    this.error = "";
    this.statusMessage = "";
    this.pendingFocus = "tree";
  }

  private handleTreeKeyDown(event: KeyboardEvent): void {
    const next = transitionSessionTreeKey(this.model, { selectedId: this.selectedId, foldedIds: this.foldedIds }, event.key);
    if (!next.handled) return;
    event.preventDefault();
    event.stopPropagation();
    if (next.action === "cancel") {
      this.onCancel?.();
      return;
    }
    if (next.action === "confirm") {
      this.continueToConfirmation();
      return;
    }
    this.selectedId = next.selectedId;
    this.foldedIds = next.foldedIds;
    this.pendingFocus = "tree";
  }

  private continueToConfirmation(): void {
    if (this.selectedId === undefined || !this.model.nodesById.has(this.selectedId)) return;
    if (!validateSessionTreeSummaryChoice(this.summaryMode, this.customInstructions).ok) {
      this.summaryMode = "none";
      this.customInstructions = "";
    }
    this.step = "confirm";
    this.error = "";
    this.statusMessage = "";
    this.pendingFocus = "summary";
  }

  private returnToTree(): void {
    if (this.busy) return;
    this.step = "tree";
    this.error = "";
    this.statusMessage = "";
    this.pendingFocus = "tree";
  }

  private selectSummaryMode(mode: SessionTreeSummaryChoice["mode"]): void {
    if (this.busy) return;
    this.summaryMode = mode;
    this.error = "";
    this.statusMessage = "";
    this.pendingFocus = mode === "custom" ? "custom" : "summary";
  }

  private handleCustomInstructionsInput(event: InputEvent): void {
    if (!(event.currentTarget instanceof HTMLTextAreaElement)) return;
    this.customInstructions = event.currentTarget.value;
    this.error = "";
    this.statusMessage = "";
  }

  private async submitNavigation(): Promise<void> {
    if (this.busy || this.selectedId === undefined) return;
    const validation = validateSessionTreeSummaryChoice(this.summaryMode, this.customInstructions);
    if (!validation.ok) {
      this.error = "";
      this.statusMessage = "";
      this.pendingFocus = "custom";
      this.requestUpdate();
      return;
    }
    const navigate = this.onNavigate;
    if (navigate === undefined) {
      this.error = t("ui.sessionTreeNavigator.sessionTreeNavigationIsUnavailableCloseAndReopen", "Session tree navigation is unavailable. Close and reopen /tree, then retry.");
      return;
    }

    const targetId = this.selectedId;
    const generation = ++this.operationGeneration;
    this.busy = true;
    this.aborting = false;
    this.error = "";
    this.statusMessage = "";
    try {
      const result = await navigate(targetId, validation.choice);
      if (generation !== this.operationGeneration) return;
      this.busy = false;
      this.aborting = false;
      if (!result.cancelled) return;
      this.step = "tree";
      this.statusMessage = result.aborted === true
        ? t("ui.sessionTreeNavigator.summaryCancelledTheSelectedHistoryEntryIsUnchanged", "Summary cancelled. The selected history entry is unchanged.")
        : t("ui.sessionTreeNavigator.navigationCancelledTheSelectedHistoryEntryIsUnchanged", "Navigation cancelled. The selected history entry is unchanged.");
      this.pendingFocus = "tree";
    } catch (error: unknown) {
      if (generation !== this.operationGeneration) return;
      this.busy = false;
      this.aborting = false;
      this.statusMessage = "";
      this.error = t("ui.sessionTreeNavigator.unableToNavigateSessionHistory", "Unable to navigate session history: {errorMessageerror}", { errorMessageerror: errorMessage(error) });
    }
  }

  private async abortNavigation(): Promise<void> {
    if (!this.busy || this.summaryMode === "none" || this.aborting) return;
    const abort = this.onAbort;
    if (abort === undefined) {
      this.error = t("ui.sessionTreeNavigator.unableToCancelTheSummaryFromThisClient", "Unable to cancel the summary from this client.");
      return;
    }
    const generation = this.operationGeneration;
    this.aborting = true;
    this.error = "";
    this.statusMessage = t("ui.sessionTreeNavigator.cancellingSummary", "Cancelling summary…");
    try {
      await abort();
    } catch (error: unknown) {
      if (generation !== this.operationGeneration) return;
      this.aborting = false;
      this.statusMessage = "";
      this.error = t("ui.sessionTreeNavigator.unableToCancelSummary", "Unable to cancel summary: {errorMessageerror}", { errorMessageerror: errorMessage(error) });
    }
  }

  private handleBackdropMouseDown(event: MouseEvent): void {
    if (event.target === event.currentTarget && !this.busy) this.onCancel?.();
  }

  private handleDialogKeyDown(event: KeyboardEvent): void {
    if (event.key === "Tab") {
      this.trapTabFocus(event);
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (this.busy) {
      if (this.summaryMode !== "none") void this.abortNavigation();
      return;
    }
    if (this.step === "confirm") this.returnToTree();
    else this.onCancel?.();
  }

  private trapTabFocus(event: KeyboardEvent): void {
    const focusable = [...this.renderRoot.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex='0']")];
    if (focusable.length === 0) {
      event.preventDefault();
      this.renderRoot.querySelector<HTMLElement>("section[role='dialog']")?.focus();
      return;
    }
    const active = this.shadowRoot?.activeElement;
    const activeIndex = focusable.findIndex((element) => element === active);
    const movingPastEnd = !event.shiftKey && activeIndex === focusable.length - 1;
    const movingBeforeStart = event.shiftKey && (activeIndex <= 0);
    if (!movingPastEnd && !movingBeforeStart) return;
    event.preventDefault();
    (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
  }

  private focusSelectedTreeItem(): void {
    const selectedId = this.selectedId;
    if (selectedId === undefined) {
      this.renderRoot.querySelector<HTMLElement>(".close-button")?.focus();
      return;
    }
    const rows = this.renderRoot.querySelectorAll<HTMLElement>("[data-tree-node-id]");
    for (const row of rows) {
      if (row.dataset["treeNodeId"] !== selectedId) continue;
      row.focus();
      row.scrollIntoView({ block: "nearest" });
      return;
    }
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 40; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    * { box-sizing: border-box; }
    .backdrop { width: 100%; height: 100dvh; background: var(--pi-overlay); overflow: hidden; }
    section[role="dialog"] { width: 100%; height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--pi-bg); overflow: hidden; }
    header, footer { display: flex; align-items: center; gap: 12px; padding: max(14px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) 14px max(18px, env(safe-area-inset-left)); border-bottom: 1px solid var(--pi-border); }
    footer { min-height: 64px; justify-content: end; padding: 12px max(18px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); border-top: 1px solid var(--pi-border); border-bottom: 0; }
    header > div { min-width: 0; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 21px; line-height: 1.25; }
    h2 { margin-top: 2px; font-size: 18px; }
    .eyebrow { display: block; color: var(--pi-muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .close-button { width: 36px; height: 36px; margin-inline-start: auto; display: grid; place-items: center; border: 0; background: transparent; color: var(--pi-muted); padding: 0; font-size: 25px; }
    .close-button:not(:disabled):hover, .close-button:not(:disabled):focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); }
    .body { min-height: 0; overflow: auto; }
    .tree-step { display: flex; flex-direction: column; gap: 10px; padding: 14px max(18px, env(safe-area-inset-right)) 16px max(18px, env(safe-area-inset-left)); }
    .tree-intro { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 20px; color: var(--pi-muted); }
    .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 12px; }
    .legend > span { display: inline-flex; align-items: center; gap: 5px; }
    .marker { width: 9px; height: 9px; border-radius: 999px; background: var(--pi-border); }
    .active-path-marker { background: var(--pi-accent); }
    .active-leaf-marker { box-shadow: 0 0 0 2px var(--pi-accent); background: var(--pi-bg); }
    .tree { min-height: 0; overflow: auto; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); overscroll-behavior: contain; }
    .tree-row { min-height: 48px; display: grid; grid-template-columns: 20px minmax(82px, auto) minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 7px 10px 7px calc(10px + var(--tree-indent)); border-bottom: 1px solid var(--pi-border-muted); cursor: pointer; outline: none; content-visibility: auto; contain-intrinsic-block-size: 48px; }
    .tree-row:last-child { border-bottom: 0; }
    .tree-row:hover { background: var(--pi-surface-hover); }
    .tree-row.selected { background: var(--pi-selection-bg); box-shadow: inset 3px 0 var(--pi-accent); }
    .tree-row:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .tree-row.active-path:not(.selected) { background: color-mix(in srgb, var(--pi-accent) 7%, var(--pi-surface)); }
    .tree-row.active-leaf { box-shadow: inset 3px 0 var(--pi-accent); }
    .tree-row.bookkeeping { color: var(--pi-muted); }
    .disclosure { width: 20px; height: 28px; display: grid; place-items: center; border-radius: 5px; color: var(--pi-muted); font-size: 15px; user-select: none; }
    .disclosure:not(.leaf):hover { color: var(--pi-text); background: var(--pi-surface-hover); }
    .disclosure.leaf { opacity: .5; }
    .metadata { display: contents; }
    .tree-row > .disclosure { grid-column: 1; grid-row: 1; }
    .tree-row > .metadata > .kind { grid-column: 2; grid-row: 1; }
    .tree-row > .entry { grid-column: 3; grid-row: 1; }
    .tree-row > .metadata > .badges { grid-column: 4; grid-row: 1; }
    .kind { display: inline-flex; align-items: center; width: fit-content; border: 1px solid var(--pi-border); border-radius: 999px; padding: 2px 7px; color: var(--pi-muted); background: var(--pi-bg); font-size: 11px; font-weight: 700; white-space: nowrap; }
    .entry { min-width: 0; display: flex; align-items: baseline; gap: 8px; }
    .summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-text); }
    .bookkeeping .summary { color: var(--pi-muted); }
    .label { max-width: 180px; overflow: hidden; text-overflow: ellipsis; border-radius: 4px; padding: 1px 5px; background: var(--pi-bg-overlay); color: var(--pi-muted); font-size: 11px; white-space: nowrap; }
    time { color: var(--pi-muted); font-size: 11px; white-space: nowrap; }
    .badges { display: flex; align-items: center; justify-content: end; gap: 5px; }
    .badge { border-radius: 999px; padding: 2px 7px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .badge.path { background: color-mix(in srgb, var(--pi-accent) 14%, transparent); color: var(--pi-text); }
    .badge.leaf { border: 1px solid var(--pi-accent); color: var(--pi-text); }
    .confirmation-step { padding: 24px max(18px, env(safe-area-inset-right)) 24px max(18px, env(safe-area-inset-left)); }
    .confirmation-card { width: min(760px, 100%); margin: 0 auto; display: grid; gap: 16px; }
    .selected-entry, .side-effects-note, .dialog-error, .dialog-status, .empty { border: 1px solid var(--pi-border); border-radius: 10px; padding: 12px 14px; }
    .selected-entry { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 8px 10px; background: var(--pi-surface); }
    .selected-entry p { grid-column: 2; color: var(--pi-muted); font-size: 12px; }
    fieldset { min-width: 0; margin: 0; padding: 0; border: 0; display: grid; gap: 9px; }
    legend { margin-bottom: 8px; font-weight: 700; }
    .summary-option { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 10px; border: 1px solid var(--pi-border); border-radius: 10px; padding: 11px 12px; background: var(--pi-surface); cursor: pointer; }
    .summary-option.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .summary-option input { margin-top: 3px; accent-color: var(--pi-accent); }
    .summary-option span { display: grid; gap: 3px; }
    .summary-option small { color: var(--pi-muted); }
    .custom-focus { display: grid; gap: 6px; margin: 2px 0 0 30px; font-weight: 600; }
    textarea { width: 100%; resize: vertical; min-height: 94px; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); padding: 9px 10px; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
    textarea:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    .character-count { justify-self: end; color: var(--pi-muted); font-size: 11px; font-weight: 400; }
    .validation-error { margin-inline-start: 30px; color: var(--pi-danger); font-size: 12px; }
    .side-effects-note { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); }
    .dialog-error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-bg)); color: var(--pi-danger); }
    .dialog-status { border-color: var(--pi-success-border); background: var(--pi-success-bg); }
    .empty { color: var(--pi-muted); background: var(--pi-surface); }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 8px 11px; font: inherit; cursor: pointer; }
    button:not(:disabled):hover { background: var(--pi-surface-hover); }
    button:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    button:disabled { opacity: .52; cursor: not-allowed; }
    button.primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-bg); font-weight: 700; }
    button.primary:not(:disabled):hover { filter: brightness(1.08); }
    button.danger { color: var(--pi-danger); }
    .footer-spacer { flex: 1; }

    @media (max-width: 760px) {
      header { padding-top: max(12px, env(safe-area-inset-top)); }
      .tree-step { padding-inline: max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-right)); }
      .tree-intro { padding-inline: 4px; }
      .tree-row { grid-template-columns: 20px minmax(0, 1fr); padding-inline-start: calc(7px + min(var(--tree-indent-mobile), 48px)); }
      .tree-row > .metadata { grid-column: 2; grid-row: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; }
      .tree-row > .metadata > .badges { margin-inline-start: auto; flex-wrap: wrap; }
      .tree-row > .entry { grid-column: 2; grid-row: 2; display: grid; gap: 3px; }
      .tree-row .summary { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
      .tree-row time { display: none; }
      .confirmation-step { padding: 18px 12px; }
      .custom-focus, .validation-error { margin-inline-start: 0; }
      footer { flex-wrap: wrap; }
    }
  `;
}

export function sessionTreeVisualDepth(depth: number): number {
  return Math.min(Math.max(0, depth), MAX_SESSION_TREE_VISUAL_DEPTH);
}

export function sessionTreeEntryReturnsToEditor(kind: SessionTreeNodeKind): boolean {
  return kind === "user" || kind === "custom-message";
}

export function sessionTreeKindLabel(kind: SessionTreeNodeKind): string {
  switch (kind) {
    case "user": return t("ui.sessionTreeNavigator.user", "User");
    case "assistant": return t("ui.sessionTreeNavigator.assistant", "Assistant");
    case "tool-result": return t("ui.sessionTreeNavigator.toolResult", "Tool result");
    case "bash": return t("ui.sessionTreeNavigator.command", "Command");
    case "custom-message": return t("ui.sessionTreeNavigator.customMessage", "Custom message");
    case "compaction": return t("ui.sessionTreeNavigator.contextCompaction", "Context compaction");
    case "branch-summary": return t("ui.sessionTreeNavigator.branchSummary", "Branch summary");
    case "model-change": return t("ui.sessionTreeNavigator.model", "Model");
    case "thinking-level-change": return t("ui.sessionTreeNavigator.thinkingLevel", "Thinking level");
    case "session-info": return t("ui.sessionTreeNavigator.sessionInformation", "Session information");
    case "label": return t("ui.sessionTreeNavigator.label", "Label");
    case "custom": return t("ui.sessionTreeNavigator.other2", "Other");
    case "other": return t("ui.sessionTreeNavigator.other", "Other");
  }
}

function isBookkeepingKind(kind: SessionTreeNodeKind): boolean {
  return kind === "model-change"
    || kind === "thinking-level-change"
    || kind === "session-info"
    || kind === "label"
    || kind === "custom"
    || kind === "other";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

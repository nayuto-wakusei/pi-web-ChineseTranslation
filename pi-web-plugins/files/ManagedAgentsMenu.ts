import type { ManagedAgentsControl, ManagedAgentsDecision, ManagedAgentsStatus, StylesheetIntegrationCapabilityV1 } from "@chainingintention/pi-web-cn/plugin-api";
import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { renderAgentsInstructionsIcon } from "./fileIcons";
import { t } from "./i18n.js";

export class ManagedAgentsMenu extends LitElement {
  @property({ attribute: false }) control: ManagedAgentsControl | undefined;
  @property() scopeKey = "";
  @property({ attribute: false }) stylesheetIntegration: StylesheetIntegrationCapabilityV1 | undefined;
  @state() private snapshot: ManagedAgentsStatus | undefined;
  @state() private reviewSnapshot: ManagedAgentsStatus | undefined;
  @state() private open = false;
  @state() private busy = false;
  @state() private error = "";
  private generation = 0;
  private request: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private releaseStyles: (() => void) | undefined;
  private shownPanel: HTMLElement | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("focus", this.onFocus);
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onFocus);
    if (this.hasUpdated) void this.refresh();
  }

  override disconnectedCallback(): void {
    this.stop();
    this.close(false);
    this.busy = false;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    window.removeEventListener("focus", this.onFocus);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onFocus);
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("scopeKey") || (changed.has("control") && (changed.get("control") === undefined || this.control === undefined))) {
      this.stop();
      this.close(false);
      this.snapshot = undefined;
      this.error = "";
      this.busy = false;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("stylesheetIntegration") || this.releaseStyles === undefined) {
      this.releaseStyles?.();
      this.releaseStyles = this.renderRoot instanceof ShadowRoot ? this.stylesheetIntegration?.registerRoot(this.renderRoot, { sharedUi: true }) : undefined;
    }
    if (changed.has("scopeKey") || (changed.has("control") && changed.get("control") === undefined)) void this.refresh();
    const panel = this.renderRoot.querySelector<HTMLElement>("[popover]");
    if (this.open && panel !== null && panel !== this.shownPanel) {
      this.shownPanel = panel;
      panel.showPopover();
      const anchor = this.renderRoot.querySelector<HTMLButtonElement>(".agents-trigger");
      if (anchor === null) return;
      const rect = anchor.getBoundingClientRect();
      const width = panel.getBoundingClientRect().width;
      panel.style.left = `${String(Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)))}px`;
      panel.style.top = `${String(Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - panel.getBoundingClientRect().height - 8)))}px`;
      panel.querySelector<HTMLButtonElement>("[data-overwrite]")?.focus();
    }
  }

  public async refresh(preserveError = false): Promise<void> {
    if (!this.isConnected || document.visibilityState === "hidden" || this.control === undefined || this.request !== undefined || this.busy) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    const request = new AbortController();
    const generation = this.generation;
    this.request = request;
    try {
      const snapshot = await this.control.status({ signal: request.signal });
      if (this.isCurrent(generation)) {
        this.snapshot = snapshot;
        if (!snapshot.available) this.close(false);
        if (this.open && (this.reviewSnapshot === undefined || preserveError)) this.reviewSnapshot = snapshot;
        if (!preserveError) this.error = "";
      }
    } catch (error) {
      if (this.isCurrent(generation) && !request.signal.aborted) this.error = errorMessage(error);
    } finally {
      if (this.request === request) this.request = undefined;
      if (this.isCurrent(generation)) this.schedule();
    }
  }

  private stop(): void {
    this.generation += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.request?.abort();
    this.request = undefined;
  }

  private isCurrent(generation: number): boolean {
    return this.isConnected && generation === this.generation;
  }

  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.refresh(); }, 30_000);
  }

  private readonly onFocus = (): void => { if (document.visibilityState !== "hidden") void this.refresh(); };
  private readonly onResize = (): void => { this.close(false); };

  private close(restoreFocus = true): void {
    this.shownPanel?.hidePopover();
    this.shownPanel = undefined;
    this.open = false;
    this.reviewSnapshot = undefined;
    if (restoreFocus) this.renderRoot.querySelector<HTMLButtonElement>(".agents-trigger")?.focus();
  }

  private async decide(action: ManagedAgentsDecision["action"]): Promise<void> {
    if (this.control === undefined || this.reviewSnapshot?.available !== true || this.busy) return;
    const control = this.control;
    const revision = this.reviewSnapshot.revision;
    this.stop();
    const generation = this.generation;
    this.busy = true;
    this.error = "";
    try {
      const snapshot = await control.decide({ action, revision });
      if (!this.isCurrent(generation)) return;
      this.snapshot = snapshot;
      this.close(this.open);
      if (action === "overwrite") this.dispatchEvent(new CustomEvent("agents-applied", { bubbles: true, composed: true }));
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.error = errorMessage(error);
    } finally {
      if (this.isCurrent(generation)) {
        this.busy = false;
        void this.refresh(true);
      }
    }
  }

  override render() {
    if (this.control === undefined || this.snapshot?.available === false || (this.snapshot === undefined && this.error === "")) return nothing;
    const snapshot = this.snapshot;
    const review = this.reviewSnapshot;
    const pending = snapshot?.available === true && snapshot.pending;
    return html`
      <button type="button" class=${pending ? "ui-button agents-trigger pending" : "ui-button agents-trigger"}
        title=${pending ? t("files.agents.pending", "AGENTS.md: changes need review") : "AGENTS.md"}
        aria-label=${pending ? t("files.agents.pending", "AGENTS.md: changes need review") : "AGENTS.md"} aria-haspopup="dialog" aria-expanded=${String(this.open)} aria-controls="agents-menu"
        @click=${() => { if (this.open) this.close(); else { this.reviewSnapshot = this.snapshot; this.open = true; void this.refresh(); } }}>${renderAgentsInstructionsIcon()}${pending ? html`<span class="pending-dot" aria-hidden="true"></span>` : nothing}</button>
      ${this.open ? html`
        <section id="agents-menu" class="ui-menu agents-menu" popover="auto" role="dialog" aria-label="AGENTS.md"
          @click=${(event: MouseEvent) => { event.stopPropagation(); }}
          @toggle=${(event: Event) => { if (Reflect.get(event, "newState") === "closed" && event.currentTarget === this.shownPanel) { this.open = false; this.shownPanel = undefined; this.reviewSnapshot = undefined; } }}
          @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); this.close(); } }}>
          <header><strong>${t("files.agents.title", "Workspace AGENTS.md")}</strong><button type="button" class="ui-button close" aria-label=${t("files.agents.close", "Close")} title=${t("files.agents.close", "Close")} @click=${() => { this.close(); }}>&times;</button></header>
          ${review?.available === true ? html`
            <dl><dt>${t("files.agents.modified", "File modified")}</dt><dd>${review.modifiedAt ?? t("files.agents.missing", "Not created")}</dd>
              <dt>${t("files.agents.templateModified", "Template updated")}</dt><dd>${review.templateModifiedAt ?? t("files.agents.notProvided", "Not provided")}</dd>
              <dt>${t("files.agents.template", "Template revision")}</dt><dd>${review.templateRevision}</dd></dl>
            <button type="button" class="ui-button ui-menu-item" data-overwrite ?disabled=${this.busy} @click=${() => { void this.decide("overwrite"); }}>${t("files.agents.overwrite", "Overwrite and back up")}</button>
            <button type="button" class="ui-button ui-menu-item" data-keep ?disabled=${this.busy} @click=${() => { void this.decide("keep"); }}>${t("files.agents.keep", "Do not overwrite")}</button>
          ` : nothing}
          ${this.error === "" ? nothing : html`<p class="error" role="alert">${this.error}</p>`}
        </section>` : nothing}
    `;
  }

  static override styles = css`
    :host { display: inline-flex; flex: 0 0 auto; }
    .agents-trigger { position: relative; width: 32px; height: 32px; padding: 6px; }
    .file-action-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    .pending { color: var(--pi-accent); outline: 1px solid var(--pi-accent); outline-offset: -2px; animation: agents-pulse 1.8s ease-in-out infinite; }
    .pending-dot { position: absolute; inset-block-start: 4px; inset-inline-end: 4px; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
    @keyframes agents-pulse { 50% { opacity: .55; } }
    @media (prefers-reduced-motion: reduce) { .pending { animation: none; } }
    .agents-menu { position: fixed; box-sizing: border-box; margin: 0; width: 300px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto; padding: 8px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-text); }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-inline-start: 6px; font-size: 13px; }
    .close { width: 28px; height: 28px; font-size: 18px; }
    dl { margin: 8px 6px 12px; font-size: 12px; overflow-wrap: anywhere; }
    dt { color: var(--pi-text-secondary); margin-top: 8px; }
    dd { margin: 2px 0 0; }
    .ui-menu-item { display: block; width: 100%; text-align: start; }
    .error { color: var(--pi-error); font-size: 12px; overflow-wrap: anywhere; margin: 8px 6px; }
  `;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

if (typeof customElements !== "undefined" && !customElements.get("pi-web-managed-agents-menu")) customElements.define("pi-web-managed-agents-menu", ManagedAgentsMenu);

import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import type { Project, Workspace } from "../api";
import { trustApi, workspacesApi } from "../api/clients";
import { t } from "../i18n";
import { stylesheetIntegrationCapability } from "../plugins/styles";

/** Project-menu trust entry for folders whose workspace list is hidden. */
@customElement("folder-project-trust")
export class FolderProjectTrust extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property() machineId = "local";
  @property({ attribute: false }) project?: Project;
  @state() private workspace: Workspace | undefined;
  @state() private trusted: boolean | undefined;
  @state() private busy = false;
  @state() private error: string | undefined;
  private generation = 0;

  override disconnectedCallback(): void {
    this.generation++;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("machineId") || changed.has("project")) void this.load();
  }

  private async load(): Promise<void> {
    const generation = ++this.generation;
    const project = this.project;
    const machineId = this.machineId;
    this.workspace = undefined;
    this.trusted = undefined;
    this.error = undefined;
    this.busy = true;
    const current = () => this.isConnected && generation === this.generation && this.project === project && this.machineId === machineId;
    if (project === undefined) return;
    try {
      const resolution = await workspacesApi.workspaceResolution(project.id, machineId);
      if (!current() || resolution.status !== "folder") return;
      const workspace = resolution.workspaces[0];
      if (workspace === undefined) return;
      this.workspace = workspace;
      const result = await trustApi.workspaceTrust(project.id, workspace.id, machineId);
      if (current()) this.trusted = result.trusted;
    } catch (error) {
      if (current()) this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (current()) this.busy = false;
    }
  }

  private async setTrust(trusted: boolean): Promise<void> {
    const workspace = this.workspace;
    if (workspace === undefined || this.busy || this.trusted === undefined) return;
    const generation = this.generation;
    const project = this.project;
    const machineId = this.machineId;
    const current = () => this.isConnected && generation === this.generation && this.project === project && this.machineId === machineId;
    this.busy = true;
    this.error = undefined;
    try {
      const result = await trustApi.setWorkspaceTrust(workspace.projectId, workspace.id, trusted, machineId);
      if (current()) this.trusted = result.trusted;
    } catch (error) {
      if (current()) this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (current()) this.busy = false;
    }
  }

  override render() {
    return html`
      ${this.workspace === undefined ? null : html`
        <label>
          <input type="checkbox" .checked=${live(this.trusted === true)} ?disabled=${this.busy || this.trusted === undefined}
            aria-describedby=${this.error === undefined ? "trust-help" : "trust-help trust-error"}
            @change=${(event: Event) => { if (event.target instanceof HTMLInputElement) void this.setTrust(event.target.checked); }} />
          <span>${t("ui.main.28dc9ba9fe2f", "Trusted")}${this.busy ? "…" : ""}</span>
        </label>
        <a id="trust-help" href="https://pi.dev/docs/latest/security" target="_blank" rel="noreferrer">${t("ui.main.4a0d54a22e9b", "Learn about project trust")}</a>
      `}
      ${this.error === undefined ? null : html`<small id="trust-error" role="alert">${this.error}</small>`}
    `;
  }

  static override styles = css`
    :host { display: block; }
    label { display: flex; align-items: center; gap: 6px; padding: 7px 9px; cursor: pointer; }
    input { margin: 0; cursor: pointer; }
    a { display: block; padding: 0 9px 7px; color: var(--pi-accent); font-size: 12px; }
    small { display: block; padding: 7px 9px; color: var(--pi-danger); overflow-wrap: anywhere; }
  `;
}

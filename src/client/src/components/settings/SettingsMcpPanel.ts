import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, type McpAuthServerOption, type SessionRef } from "../../api";
import { LocalizationController, localization } from "../../localization/browser";
import source from "./settingsMcp.messages";
import { stylesheetIntegrationCapability } from "../../plugins/styles";
import { uiButtonStyles } from "../ui/controlStyles";
import { uiSettingsStyles } from "../ui/settingsStyles";
import "./SettingsPanelFrame";

export const mcpMessages = localization.registerMessages("core.settingsMcp", source);

interface McpPanelError { kind: "load" | "auth"; diagnostic: string }

export interface McpAuthContext {
  session: SessionRef;
  machineId: string;
}

export type McpAuthHandler = (mode: "login" | "logout", serverName: string, context: McpAuthContext) => void | Promise<void>;

@customElement("settings-mcp-panel")
export class SettingsMcpPanel extends LitElement {
  constructor() {
    super();
    new LocalizationController(this);
    stylesheetIntegrationCapability.createController(this);
  }

  /** The parent supplies only a selected, nonarchived session on the settings machine. */
  @property({ attribute: false, hasChanged: (next: McpAuthContext | undefined, previous: McpAuthContext | undefined) =>
    next?.machineId !== previous?.machineId || next?.session.id !== previous?.session.id || next?.session.cwd !== previous?.session.cwd,
  }) context: McpAuthContext | undefined;
  @property() targetLabel = "";
  @property({ attribute: false }) onMcpAuth: McpAuthHandler | undefined;
  @state() private servers: McpAuthServerOption[] = [];
  @state() private loading = false;
  @state() private error: McpPanelError | undefined;
  private generation = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) void this.reload();
  }

  override disconnectedCallback(): void {
    this.generation += 1;
    this.servers = [];
    this.error = undefined;
    this.loading = false;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("context")) void this.reload();
  }

  private isCurrent(generation: number, context: McpAuthContext): boolean {
    return this.isConnected && generation === this.generation
      && context.machineId === this.context?.machineId
      && context.session.id === this.context.session.id
      && context.session.cwd === this.context.session.cwd;
  }

  private async reload(): Promise<void> {
    const generation = ++this.generation;
    this.servers = [];
    this.error = undefined;
    this.loading = false;
    if (!this.isConnected || this.context === undefined) return;
    const context = { machineId: this.context.machineId, session: { ...this.context.session } };
    this.loading = true;
    try {
      const response = await api.mcpAuthServers(context.session, context.machineId);
      if (this.isCurrent(generation, context)) this.servers = response.servers;
    } catch (error) {
      if (this.isCurrent(generation, context)) this.error = { kind: "load", diagnostic: errorMessage(error) };
    } finally {
      if (this.isCurrent(generation, context)) this.loading = false;
    }
  }

  private async authenticate(mode: "login" | "logout", serverName: string, context: McpAuthContext): Promise<void> {
    const generation = this.generation;
    try {
      await this.onMcpAuth?.(mode, serverName, context);
    } catch (error) {
      if (this.isCurrent(generation, context)) this.error = { kind: "auth", diagnostic: errorMessage(error) };
    }
  }

  override render(): TemplateResult {
    const context = this.context === undefined ? undefined : {
      machineId: this.context.machineId, session: { ...this.context.session },
    };
    return html`
      <settings-panel-frame
        .heading=${mcpMessages.t("heading")}
        .description=${mcpMessages.t("description")}
        .actionLabel=${mcpMessages.t("refresh")}
        .actionDisabled=${context === undefined || this.loading}
        .onAction=${() => this.reload()}
        .notices=${this.error === undefined ? [] : [{ type: "error", content: mcpMessages.t(this.error.kind === "load" ? "loadError" : "authError", { error: this.error.diagnostic }) }]}
      >
        <section class="ui-settings-section">
          ${context === undefined ? html`
            <p role="status">${mcpMessages.t("selectSession", { target: this.targetLabel || mcpMessages.t("thisMachine") })}</p>
          ` : html`
            <div class="ui-settings-heading"><h3>${mcpMessages.t("context")}</h3></div>
            <div class="ui-settings-summary session-context" aria-label=${mcpMessages.t("contextAria")}>
              <span><strong>${mcpMessages.t("machine")}</strong> <bdi>${this.targetLabel || mcpMessages.t("thisMachine")}</bdi></span>
              <span><strong>${mcpMessages.t("session")}</strong> <bdi>${context.session.id}</bdi></span>
              <span><strong>${mcpMessages.t("workspace")}</strong> <bdi dir="ltr">${context.session.cwd}</bdi></span>
            </div>
            <p>${mcpMessages.t("logoutHelp")}</p>
            ${this.loading ? html`<p role="status">${mcpMessages.t("loading")}</p>` : this.error !== undefined ? null : this.servers.length === 0 ? html`
              <p role="status">${mcpMessages.t("empty")}</p>
            ` : html`
              <ul class="ui-settings-list server-list" aria-label=${mcpMessages.t("serversAria")}>
                ${this.servers.map((server) => html`
                  <li class="ui-settings-row">
                    <div class="server-copy ui-settings-heading">
                      <h3 dir="auto">${server.name}</h3>
                      ${server.description === undefined ? null : html`<p class="server-description" dir="auto">${server.description}</p>`}
                    </div>
                    <div class="ui-settings-actions">
                      <button class="ui-button ui-button--action" aria-label=${mcpMessages.t("loginAria", { name: server.name })} ?disabled=${this.onMcpAuth === undefined} @click=${() => { void this.authenticate("login", server.name, context); }}>${mcpMessages.t("login")}</button>
                      <button class="ui-button ui-button--action" aria-label=${mcpMessages.t("logoutAria", { name: server.name })} ?disabled=${this.onMcpAuth === undefined} @click=${() => { void this.authenticate("logout", server.name, context); }}>${mcpMessages.t("logout")}</button>
                    </div>
                  </li>
                `)}
              </ul>
            `}
          `}
        </section>
      </settings-panel-frame>
    `;
  }

  static override styles = [uiButtonStyles, uiSettingsStyles, css`
    @layer pi-web-base {
    :host { display: block; }
    p { line-height: 1.45; }
    .ui-settings-section > p { margin: 0; }
    .session-context { overflow-wrap: anywhere; }
    .server-list { margin: 0; padding: 0; list-style: none; }
    .server-copy { flex: 1 1 240px; min-width: 0; }
    .server-description { white-space: pre-wrap; overflow-wrap: anywhere; }
    }
  `];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-mcp-panel": SettingsMcpPanel;
  }
}

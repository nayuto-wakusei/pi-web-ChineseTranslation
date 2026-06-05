import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PiWebConfigEnvOverrides, PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { configFromDraft, draftFromConfig, emptyConfigDraft, type ConfigDraft } from "./settingsConfigDraft";

@customElement("settings-general-panel")
export class SettingsGeneralPanel extends LitElement {
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues) => void | Promise<void>;
  @state() private draft: ConfigDraft = emptyConfigDraft();
  @state() private localError = "";

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("configResponse") && this.configResponse !== undefined) {
      this.draft = draftFromConfig(this.configResponse.config);
      this.localError = "";
    }
  }

  override render(): TemplateResult {
    const config = this.configResponse;
    return html`
      <div class="section-heading">
        <div>
          <h2>通用配置</h2>
          <p>更新 PI WEB 正在使用的 JSON 配置文件。Host 和端口会立即保存，但需要重启 Web 服务后，运行中的服务器才会绑定到新地址。</p>
        </div>
        <button class="secondary" ?disabled=${this.loading} @click=${() => { void this.onReload?.(); }}>重新加载</button>
      </div>
      ${this.renderMessages()}
      ${config === undefined && this.loading ? html`<div class="loading-card">正在加载配置…</div>` : html`
        <div class="config-path-card">
          <span>配置文件</span>
          <code>${config?.path ?? "未知"}</code>
          <small>${config?.exists === true ? "已有文件" : "保存时会创建此文件"}</small>
        </div>
        <form class="config-form" @submit=${(event: Event) => { void this.saveConfig(event); }}>
          <label class="field">
            <span class="field-heading">
              <span>Host</span>
              ${this.renderOverrideBadge("host")}
            </span>
            <input .value=${this.draft.host} placeholder="127.0.0.1" autocomplete="off" spellcheck="false" @input=${(event: Event) => { this.updateDraft({ host: inputValue(event) }); }}>
            <small>Web 服务器应绑定的地址。留空则使用 PI WEB 默认值。</small>
          </label>

          <label class="field">
            <span class="field-heading">
              <span>Port</span>
              ${this.renderOverrideBadge("port")}
            </span>
            <input .value=${this.draft.port} inputmode="numeric" pattern="[0-9]*" placeholder="8504" autocomplete="off" @input=${(event: Event) => { this.updateDraft({ port: inputValue(event) }); }}>
            <small>TCP 端口，范围 1 到 65535。留空则使用 PI WEB 默认值。</small>
          </label>

          <div class="field">
            <span class="field-heading">
              <span>允许的 hosts</span>
              ${this.renderOverrideBadge("allowedHosts")}
            </span>
            <select .value=${this.draft.allowedHostsMode} @change=${(event: Event) => { this.updateDraft({ allowedHostsMode: selectValue(event) === "all" ? "all" : "list" }); }}>
              <option value="list">仅允许列出的 hosts</option>
              <option value="all">允许所有 host</option>
            </select>
            <textarea .value=${this.draft.allowedHostsText} ?disabled=${this.draft.allowedHostsMode === "all"} rows="4" placeholder="example.local&#10;192.168.1.20" spellcheck="false" @input=${(event: Event) => { this.updateDraft({ allowedHostsText: textAreaValue(event) }); }}></textarea>
            <small>每行输入一个 host，或选择“允许所有 host”写入 <code>true</code>。</small>
          </div>

          ${this.renderEffectiveConfig()}

          <footer class="form-actions">
            <button class="primary" ?disabled=${this.loading || this.saving}>${this.saving ? "正在保存…" : "保存配置"}</button>
          </footer>
        </form>
      `}
    `;
  }

  private renderMessages(): TemplateResult | null {
    const error = this.localError || this.error;
    if (error !== "") return html`<div class="message error-message">${error}</div>`;
    if (this.savedMessage !== "") return html`<div class="message success-message">${this.savedMessage}</div>`;
    return null;
  }

  private renderOverrideBadge(key: keyof PiWebConfigEnvOverrides): TemplateResult | null {
    if (this.configResponse?.envOverrides[key] !== true) return null;
    return html`<span class="override-badge">环境变量覆盖</span>`;
  }

  private renderEffectiveConfig(): TemplateResult {
    const effective = this.configResponse?.effectiveConfig ?? {};
    return html`
      <section class="effective-card" aria-label="最终生效配置摘要">
        <h3>环境变量覆盖后的生效配置</h3>
        <dl>
          <div><dt>Host</dt><dd>${effective.host ?? html`<span class="muted">默认 127.0.0.1</span>`}</dd></div>
          <div><dt>端口</dt><dd>${effective.port ?? html`<span class="muted">默认 8504</span>`}</dd></div>
          <div><dt>允许的 hosts</dt><dd>${formatAllowedHosts(effective.allowedHosts)}</dd></div>
        </dl>
      </section>
    `;
  }

  private async saveConfig(event: Event): Promise<void> {
    event.preventDefault();
    this.localError = "";
    try {
      await this.onSave?.(configFromDraft(this.draft, this.configResponse?.config ?? {}));
    } catch (error) {
      this.localError = errorMessage(error);
    }
  }

  private updateDraft(patch: Partial<ConfigDraft>): void {
    this.draft = { ...this.draft, ...patch };
    this.localError = "";
  }

  static override styles = css`
    :host { display: block; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
    .section-heading > div { display: grid; gap: 6px; min-width: 0; }
    h2, h3, p { margin: 0; }
    h2 { font-size: 17px; line-height: 1.25; }
    h3 { font-size: 13px; line-height: 1.3; }
    p { color: var(--pi-muted); line-height: 1.45; }
    button, input, select, textarea { font: inherit; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .secondary { flex: 0 0 auto; }
    .message, .loading-card, .config-path-card, .effective-card { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .message { margin-bottom: 12px; }
    .error-message { border-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); }
    .success-message { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-surface); }
    .loading-card { color: var(--pi-muted); }
    .config-path-card { display: grid; gap: 5px; margin-bottom: 14px; }
    .config-path-card span, .field-heading, dt { color: var(--pi-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .config-path-card small, .field small { color: var(--pi-muted); }
    .config-form { display: grid; gap: 14px; }
    .field { display: grid; gap: 7px; }
    .field-heading { display: flex; align-items: center; gap: 8px; }
    input, select, textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); padding: 9px 10px; outline: none; }
    input:focus, select:focus, textarea:focus { border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent-border); }
    textarea { resize: vertical; min-height: 94px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    textarea:disabled { opacity: .55; }
    .override-badge { border: 1px solid var(--pi-warning-border); border-radius: 999px; color: var(--pi-warning); background: var(--pi-warning-surface); padding: 2px 7px; font-size: 11px; font-weight: 600; text-transform: none; }
    .effective-card { display: grid; gap: 10px; }
    .effective-card dl { display: grid; gap: 8px; margin: 0; }
    .effective-card dl > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; align-items: baseline; }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .muted { color: var(--pi-muted); }
    .form-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }
    .primary { border-color: var(--pi-accent); background: var(--pi-selection-bg); color: var(--pi-text-bright); }

    @media (max-width: 760px) {
      .section-heading { display: grid; gap: 12px; }
      .section-heading .secondary { justify-self: start; }
      .effective-card dl > div { grid-template-columns: minmax(0, 1fr); gap: 3px; }
    }
  `;
}

function formatAllowedHosts(value: PiWebConfigValues["allowedHosts"]): string | TemplateResult {
  if (value === true) return "任意 host";
  if (Array.isArray(value)) return value.length === 0 ? html`<span class="muted">未列出</span>` : value.join(", ");
  return html`<span class="muted">未设置</span>`;
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

function selectValue(event: Event): string {
  return event.target instanceof HTMLSelectElement ? event.target.value : "";
}

function textAreaValue(event: Event): string {
  return event.target instanceof HTMLTextAreaElement ? event.target.value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

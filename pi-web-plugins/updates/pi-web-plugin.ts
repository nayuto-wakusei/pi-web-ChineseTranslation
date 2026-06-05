import type { TemplateResult } from "lit";
import type { HtmlTemplateTag, PiWebComponentStatus, PiWebInstallationInfo, PiWebPlugin, PiWebStatusMessage, PiWebStatusResponse, PluginRuntimeState } from "@chainingintention/pi-web-cn/plugin-api";

function messagesFor(state: PluginRuntimeState | undefined): PiWebStatusMessage[] {
  return state?.piWebStatus?.messages ?? [];
}

function statusFor(state: PluginRuntimeState | undefined): PiWebStatusResponse | undefined {
  return state?.piWebStatus;
}

function messageCount(state: PluginRuntimeState | undefined): number {
  return messagesFor(state).length;
}

function isLocalOrUnknownInstallation(installation: PiWebInstallationInfo | undefined): boolean {
  return installation === undefined || installation.kind === "local" || installation.kind === "unknown";
}

function shouldShowUpdatesPanel(state: PluginRuntimeState | undefined): boolean {
  const status = statusFor(state);
  if (messageCount(state) > 0) return true;
  if (status === undefined) return false;
  return isLocalOrUnknownInstallation(status.components.web.installation)
    || isLocalOrUnknownInstallation(status.components.sessiond.installation);
}

function formatVersion(version: string | undefined): string {
  return version === undefined || version === "" ? "未知" : version;
}

function installationLabel(installation: PiWebInstallationInfo | undefined): string {
  if (installation === undefined) return "安装来源未知";
  if (installation.kind === "pi-package") {
    const scope = installation.scope === undefined ? "" : ` · ${installation.scope}`;
    const source = installation.source ?? "Pi 包";
    return `${source}${scope}`;
  }
  if (installation.kind === "npm-global") return "全局 npm 包";
  if (installation.kind === "local") return "本地检出";
  return "安装来源未知";
}

function componentLabel(label: string): string {
  if (label === "Web") return "Web/UI";
  if (label === "Session daemon") return "会话守护进程";
  return label;
}

function severityLabel(severity: PiWebStatusMessage["severity"]): string {
  if (severity === "error") return "错误";
  if (severity === "warning") return "警告";
  return "信息";
}

function renderComponent(html: HtmlTemplateTag, component: PiWebComponentStatus): TemplateResult {
  const status = !component.available
    ? "不可用"
    : component.stale
      ? "需要重启"
      : "当前版本";
  return html`
    <div class="updates-version-row">
      <strong>${componentLabel(component.label)}</strong>
      <span>${status}</span>
      <small>运行中 ${formatVersion(component.runtimeVersion)} · 已安装 ${formatVersion(component.installedVersion)}</small>
      <small>${installationLabel(component.installation)}${component.installation?.path === undefined ? "" : ` · ${component.installation.path}`}</small>
    </div>
  `;
}

function renderCommand(html: HtmlTemplateTag, label: string, command: string): TemplateResult {
  return html`
    <div class="updates-command">
      <span>${label}</span>
      <code>${command}</code>
      <button @click=${() => { void navigator.clipboard.writeText(command); }}>复制</button>
    </div>
  `;
}

function renderCommands(html: HtmlTemplateTag, status: PiWebStatusResponse): TemplateResult | undefined {
  const commands = [
    ["更新", status.commands.update],
    ["全部重启", status.commands.restart],
    ["重启 Web/UI", status.commands.restartWeb],
    ["重启会话守护进程", status.commands.restartSessiond],
    ["状态", status.commands.status],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "");

  if (commands.length === 0) return undefined;
  return html`
    <section>
      <strong>建议命令</strong>
      ${commands.map(([label, command]) => renderCommand(html, label, command))}
    </section>
  `;
}

function renderUpdatesPanel(html: HtmlTemplateTag, state: PluginRuntimeState | undefined): TemplateResult {
  const status = statusFor(state);
  if (status === undefined) {
    return html`
      <section class="toolbar"><strong>更新</strong></section>
      <section class="viewer"><p class="muted">正在检查 PI WEB 更新状态…</p></section>
    `;
  }

  const messages = status.messages;
  return html`
    <style>
      .viewer.updates-status { flex: 1 1 auto; min-height: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; padding: 12px; overflow-y: auto; overflow-x: hidden; }
      .viewer.updates-status section { flex: 0 0 auto; min-width: 0; display: grid; gap: 8px; }
      .updates-message { display: grid; gap: 5px; border: 1px solid var(--pi-border); border-radius: 8px; padding: 10px; background: var(--pi-surface); }
      .updates-message.warning { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); }
      .updates-message.error { border-color: var(--pi-danger); }
      .updates-message-title { display: flex; gap: 8px; align-items: baseline; }
      .updates-message-title span { color: var(--pi-muted); font-size: 12px; text-transform: uppercase; }
      .updates-version-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 10px; border-bottom: 1px solid var(--pi-border-muted); padding: 6px 0; }
      .updates-version-row small { grid-column: 1 / -1; color: var(--pi-muted); }
      .updates-command { min-width: 0; display: grid; grid-template-columns: minmax(90px, auto) minmax(0, 1fr) auto; gap: 8px; align-items: center; }
      .updates-command code { overflow: auto; border: 1px solid var(--pi-border-muted); border-radius: 6px; background: var(--pi-bg); padding: 5px 7px; white-space: nowrap; }
      .updates-meta { display: grid; gap: 2px; color: var(--pi-muted); font-size: 12px; }
      @media (max-width: 520px) {
        .updates-command { grid-template-columns: minmax(0, 1fr) auto; }
        .updates-command > span { grid-column: 1 / -1; }
      }
    </style>
    <section class="toolbar"><strong>更新</strong><span class="stale">测试版</span>${messages.length > 0 ? html`<span class="stale">${String(messages.length)}</span>` : null}</section>
    <section class="viewer updates-status">
      <section>
        ${messages.length === 0 ? html`<p class="muted">没有 PI WEB 更新或重启消息。</p>` : messages.map((message) => html`
          <article class=${`updates-message ${message.severity}`}>
            <div class="updates-message-title"><strong>${message.title}</strong><span>${severityLabel(message.severity)}</span></div>
            <p>${message.body}</p>
            ${message.command === undefined ? null : html`<code>${message.command}</code>`}
          </article>
        `)}
      </section>

      <section>
        <strong>已安装服务</strong>
        ${renderComponent(html, status.components.web)}
        ${renderComponent(html, status.components.sessiond)}
      </section>

      ${renderCommands(html, status)}

      <section class="updates-meta">
        <span>生成时间 ${status.generatedAt}</span>
        ${status.release.latestVersion === undefined ? null : html`<span>最新 npm 版本 ${status.release.latestVersion}</span>`}
        ${status.release.skipped === true ? html`<span>远程版本检查已跳过。</span>` : null}
        ${status.release.error === undefined ? null : html`<span>远程版本检查失败：${status.release.error}</span>`}
      </section>
    </section>
  `;
}

const plugin: PiWebPlugin = {
  apiVersion: 1,
  name: "更新",
  activate: ({ html, svg }) => ({
    contributions: {
      workspacePanels: [
        {
          id: "workspace.updates",
          title: "更新",
          icon: svg`
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6v5h-5"></path>
              <path d="M4 18v-5h5"></path>
              <path d="M18.4 9A7 7 0 0 0 6.1 6.7L4 8.8"></path>
              <path d="M5.6 15A7 7 0 0 0 17.9 17.3L20 15.2"></path>
            </svg>
          `,
          order: 100,
          visible: (context) => shouldShowUpdatesPanel(context.state),
          badge: (context) => {
            const count = messageCount(context.state);
            return html`测试版${count > 0 ? html` · ${String(count)}` : null}`;
          },
          render: (context) => renderUpdatesPanel(html, context.state),
        },
      ],
    },
  }),
};

export default plugin;

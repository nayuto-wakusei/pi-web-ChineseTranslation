import type { TemplateResult } from "lit";
import type { HtmlTemplateTag, PiWebComponentStatus, PiWebPlugin, PiWebStatusMessage, PluginRuntimeState, WorkspacePanelTerminal } from "@chainingintention/pi-web-cn/plugin-api";
import { additionalCommands, fallbackDockerStatus, formatVersion, installationLabel, messageCount, recommendedCommand, shouldShowUpdatesPanel, statusFor, type CommandEntry, type UpdatesRuntimeHint } from "./updatesLogic.js";

function runCommandInTerminal(terminal: WorkspacePanelTerminal, label: string, command: string): void {
  void terminal.runCommand({
    title: label,
    command,
    open: true,
    metadata: { "pi.plugin": "updates" },
  }).catch((error: unknown) => {
    console.error(`更新插件执行 "${label}" 失败`, error);
  });
}

async function copyCommandToClipboard(command: string, target: EventTarget | null | undefined): Promise<void> {
  const button = typeof HTMLButtonElement === "undefined" ? undefined : target instanceof HTMLButtonElement ? target : undefined;
  const copied = await writeClipboard(command);
  if (button === undefined) return;
  const original = button.textContent;
  button.textContent = copied ? "已复制" : "复制失败";
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = clipboardTarget();
    if (clipboard !== undefined) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to execCommand below.
  }

  return copyWithSelectionFallback(text);
}

function clipboardTarget(): { writeText(text: string): Promise<void> } | undefined {
  if (typeof navigator === "undefined") return undefined;
  const clipboard = Reflect.get(navigator, "clipboard");
  if (!isClipboard(clipboard)) return undefined;
  return clipboard;
}

function isClipboard(value: unknown): value is { writeText(text: string): Promise<void> } {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "writeText") === "function";
}

function copyWithSelectionFallback(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  document.body.append(textarea);
  textarea.select();
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Compatibility fallback when Clipboard API is unavailable.
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function renderComponent(html: HtmlTemplateTag, component: PiWebComponentStatus): TemplateResult {
  const label = component.component === "sessiond" ? "会话守护进程" : "Web/界面";
  const status = !component.available
    ? "不可用"
    : component.stale
      ? "需要重启"
      : "当前版本";
  return html`
    <div class="updates-version-row">
      <strong>${label}</strong>
      <span>${status}</span>
      <small>运行中 ${formatVersion(component.runtimeVersion)} · 已安装 ${formatVersion(component.installedVersion)}</small>
      <small>${installationLabel(component.installation)}${component.installation?.path === undefined ? "" : ` · ${component.installation.path}`}</small>
    </div>
  `;
}

function renderCommandActions(html: HtmlTemplateTag, terminal: WorkspacePanelTerminal | undefined, label: string, command: string): TemplateResult {
  return html`
    <span class="updates-command-actions">
      <button @click=${(event?: Event) => { void copyCommandToClipboard(command, event?.currentTarget); }}>复制</button>
      ${terminal === undefined ? null : html`<button class="primary" @click=${() => { runCommandInTerminal(terminal, label, command); }}>运行</button>`}
    </span>
  `;
}

function renderCommand(html: HtmlTemplateTag, terminal: WorkspacePanelTerminal | undefined, label: string, command: string): TemplateResult {
  return html`
    <div class="updates-command">
      <span>${label}</span>
      <code>${command}</code>
      ${renderCommandActions(html, terminal, label, command)}
    </div>
  `;
}

function updatesRuntimeHintFromModuleUrl(moduleUrl: string): UpdatesRuntimeHint {
  try {
    const dockerMode = new URL(moduleUrl).searchParams.get("piWebDockerMode");
    return dockerMode === "runtime" || dockerMode === "dev" ? { dockerMode } : {};
  } catch {
    return {};
  }
}

const runtimeHint = updatesRuntimeHintFromModuleUrl(import.meta.url);

function renderNotice(html: HtmlTemplateTag, message: PiWebStatusMessage): TemplateResult {
  return html`
    <article class=${`updates-message ${message.severity}`}>
      <div class="updates-message-title"><strong>${message.title}</strong><span>${severityLabel(message.severity)}</span></div>
      <p>${message.body}</p>
    </article>
  `;
}

function renderNotices(html: HtmlTemplateTag, messages: readonly PiWebStatusMessage[]): TemplateResult {
  return html`<section>${messages.length === 0 ? html`<p class="muted">没有 PI WEB 更新或重启消息。</p>` : messages.map((message) => renderNotice(html, message))}</section>`;
}

function renderRecommended(html: HtmlTemplateTag, terminal: WorkspacePanelTerminal | undefined, recommended: CommandEntry, messages: readonly PiWebStatusMessage[]): TemplateResult {
  return html`
    <section class="updates-recommended">
      <strong>推荐</strong>
      ${messages.length === 0 ? html`<p class="muted">运行这一条命令即可将当前安装更新到最新状态。不需要其他操作。</p>` : messages.map((message) => renderNotice(html, message))}
      ${renderCommand(html, terminal, recommended.label, recommended.command)}
    </section>
  `;
}

function renderAdditionalCommands(html: HtmlTemplateTag, terminal: WorkspacePanelTerminal | undefined, additional: readonly CommandEntry[], hasRecommended: boolean): TemplateResult | undefined {
  if (additional.length === 0) return undefined;
  return html`
    <section>
      <strong>${hasRecommended ? "其他命令（可选）" : "建议命令"}</strong>
      ${hasRecommended ? html`<p class="muted">仅在需要更细粒度控制时使用，例如只重启某个服务。</p>` : null}
      ${additional.map((entry) => renderCommand(html, terminal, entry.label, entry.command))}
    </section>
  `;
}

function renderUpdatesPanel(html: HtmlTemplateTag, terminal: WorkspacePanelTerminal | undefined, state: PluginRuntimeState | undefined): TemplateResult {
  const status = statusFor(state) ?? fallbackDockerStatus(runtimeHint);
  if (status === undefined) {
    return html`
      <section class="toolbar"><strong>更新</strong></section>
      <section class="viewer"><p class="muted">正在检查 PI WEB 更新状态…</p></section>
    `;
  }

  const messages = status.messages;
  const recommended = recommendedCommand(status);
  const additional = additionalCommands(status, recommended);
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
      .updates-command-actions { display: inline-flex; gap: 6px; }
      .updates-command-actions button.primary { border-color: var(--pi-accent-border); color: var(--pi-text-bright); }
      .updates-recommended { border: 1px solid var(--pi-accent-border); border-radius: 8px; padding: 10px; background: var(--pi-surface); }
      .updates-recommended > strong { color: var(--pi-text-bright); }
      .updates-recommended .updates-message { border: none; background: none; padding: 0; }
      .updates-meta { display: grid; gap: 2px; color: var(--pi-muted); font-size: 12px; }
      @media (max-width: 520px) {
        .updates-command { grid-template-columns: minmax(0, 1fr) auto; }
        .updates-command > span { grid-column: 1 / -1; }
      }
    </style>
    <section class="toolbar"><strong>更新</strong>${messages.length > 0 ? html`<span class="stale">${String(messages.length)}</span>` : null}</section>
    <section class="viewer updates-status">
      ${recommended === undefined ? renderNotices(html, messages) : renderRecommended(html, terminal, recommended, messages)}

      <section>
        <strong>已安装服务</strong>
        ${renderComponent(html, status.components.web)}
        ${renderComponent(html, status.components.sessiond)}
      </section>

      ${renderAdditionalCommands(html, terminal, additional, recommended !== undefined)}

      <section class="updates-meta">
        <span>生成时间 ${status.generatedAt}</span>
        ${status.release.latestVersion === undefined ? null : html`<span>最新 npm 版本 ${status.release.latestVersion}</span>`}
        ${status.release.skipped === true ? html`<span>远程版本检查已跳过。</span>` : null}
        ${status.release.error === undefined ? null : html`<span>远程版本检查失败：${status.release.error}</span>`}
      </section>
    </section>
  `;
}

function severityLabel(severity: string): string {
  if (severity === "warning") return "警告";
  if (severity === "error") return "错误";
  return severity;
}

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "更新",
  activate: ({ html, svg }) => ({
    contributions: {
      actions: [
        {
          id: "check",
          title: "检查 PI WEB 更新",
          description: "忽略缓存的发布信息，立即检查所选机器",
          group: "更新",
          enabled: (context) => context.checkForPiWebUpdates !== undefined,
          disabledReason: () => "检查更新需要较新版本的 PI WEB 网关",
          run: (context) => context.checkForPiWebUpdates?.(),
        },
      ],
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
          visible: (context) => shouldShowUpdatesPanel(context.state, runtimeHint),
          badge: (context) => {
            const count = messageCount(context.state);
            return count > 0 ? count : undefined;
          },
          render: (context) => renderUpdatesPanel(html, context.terminal, context.state),
        },
      ],
    },
  }),
};

export default plugin;

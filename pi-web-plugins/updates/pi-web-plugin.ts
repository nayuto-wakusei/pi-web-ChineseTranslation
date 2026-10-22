import { t, setTranslator } from "./i18n.js";
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
    console.error(t("ui.main.3b3df75b9391", "Updates plugin failed to run \"{arg0}\"", { arg0: label }), error);
  });
}

async function copyCommandToClipboard(command: string, target: EventTarget | null | undefined): Promise<void> {
  const button = typeof HTMLButtonElement === "undefined" ? undefined : target instanceof HTMLButtonElement ? target : undefined;
  const copied = await writeClipboard(command);
  if (button === undefined) return;
  const original = button.textContent;
  button.textContent = copied ? t("ui.toolExecutionView.copied", "Copied") : t("bundled.updates.copy.failed.753d8b", "Copy failed");
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
  const label = component.component === "sessiond" ? t("bundled.updates.session.daemon.757666", "Session daemon") : t("bundled.updates.web.ui.86d6a2", "Web/UI");
  const status = !component.available
    ? t("bundled.info.unavailable.460b35", "Unavailable")
    : component.stale
      ? t("bundled.info.restart.needed.1ffd00", "Restart needed")
      : t("bundled.info.current.837bc9", "Current");
  return html`
    <div class="updates-version-row">
      <strong>${label}</strong>
      <span>${status}</span>
      <small>${t("ui.toolExecutionView.running", "Running")} ${formatVersion(component.runtimeVersion)}${t("ui.main.b2a2f69aef6f", " · installed ")}${formatVersion(component.installedVersion)}</small>
      <small>${installationLabel(component.installation)}${component.installation?.path === undefined ? "" : ` · ${component.installation.path}`}</small>
    </div>
  `;
}

function renderCommandActions(html: HtmlTemplateTag, terminal: WorkspacePanelTerminal | undefined, label: string, command: string): TemplateResult {
  return html`
    <span class="updates-command-actions">
      <button type="button" class="ui-button ui-button--action ui-button--compact" @click=${(event?: Event) => { void copyCommandToClipboard(command, event?.currentTarget); }}>${t("bundled.updates.copy.63d90d", "Copy")}</button>
      ${terminal === undefined ? null : html`<button type="button" class="ui-button ui-button--action ui-button--compact ui-button--primary" @click=${() => { runCommandInTerminal(terminal, label, command); }}>${t("bundled.workspace-tasks.run.75b269", "Run")}</button>`}
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
  return html`<section>${messages.length === 0 ? html`<p class="muted">${t("bundled.updates.no.pi.web.update.or.restart.messages.a2f50d", "No PI WEB update or restart messages.")}</p>` : messages.map((message) => renderNotice(html, message))}</section>`;
}

function renderRecommended(html: HtmlTemplateTag, terminal: WorkspacePanelTerminal | undefined, recommended: CommandEntry, messages: readonly PiWebStatusMessage[]): TemplateResult {
  return html`
    <section class="updates-recommended">
      <strong>${t("bundled.updates.recommended.1452de", "Recommended")}</strong>
      ${messages.length === 0 ? html`<p class="muted">${t("bundled.updates.confirmationAndSafeExecution", "Run the recommended command. Updates require confirmation in the terminal and may interrupt active sessions; the CLI will provide instructions if this terminal cannot safely run the update.")}</p>` : messages.map((message) => renderNotice(html, message))}
      ${renderCommand(html, terminal, recommended.label, recommended.command)}
    </section>
  `;
}

function renderAdditionalCommands(html: HtmlTemplateTag, terminal: WorkspacePanelTerminal | undefined, additional: readonly CommandEntry[], hasRecommended: boolean): TemplateResult | undefined {
  if (additional.length === 0) return undefined;
  return html`
    <section>
      <strong>${hasRecommended ? t("ui.main.7ccbaa176fa0", "Additional commands (optional)") : t("bundled.updates.suggested.commands.d22916", "Suggested commands")}</strong>
      ${hasRecommended ? html`<p class="muted">${t("bundled.updates.use.only.for.finer.control.such.as.restarting.a.single.service.f2c8d9", "Use only for finer control, such as restarting a single service.")}</p>` : null}
      ${additional.map((entry) => renderCommand(html, terminal, entry.label, entry.command))}
    </section>
  `;
}

function renderUpdatesPanel(html: HtmlTemplateTag, terminal: WorkspacePanelTerminal | undefined, state: PluginRuntimeState | undefined): TemplateResult {
  const status = statusFor(state) ?? fallbackDockerStatus(runtimeHint);
  if (status === undefined) {
    return html`
      <section class="ui-toolbar updates-toolbar"><strong class="ui-toolbar-title">${t("bundled.updates.updates.3055a0", "Updates")}</strong></section>
      <section class="viewer"><p class="muted">${t("bundled.updates.checking.pi.web.update.status.24e243", "Checking PI WEB update status...")}</p></section>
    `;
  }

  const messages = status.messages;
  const recommended = recommendedCommand(status);
  const additional = additionalCommands(status, recommended);
  return html`
    <style>
      .updates-toolbar { flex: 0 0 auto; padding-inline: 12px; border-bottom: 1px solid var(--pi-border-muted); }
      .viewer.updates-status { flex: 1 1 auto; min-height: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; padding: 12px; overflow-y: auto; overflow-x: hidden; }
      .viewer.updates-status section { flex: 0 0 auto; min-width: 0; display: grid; gap: 8px; }
      .updates-message { display: grid; gap: 5px; border: 1px solid var(--pi-border); border-radius: 8px; padding: 10px; background: var(--pi-surface); }
      .updates-message.warning { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); }
      .updates-message.error { border-color: var(--pi-danger); }
      .updates-message-title { display: flex; gap: 8px; align-items: baseline; }
      .updates-message-title span { color: var(--pi-muted); font-size: 12px; text-transform: uppercase; }
      .updates-version-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 10px; border-bottom: 1px solid var(--pi-border-muted); padding: 6px 0; }
      .updates-version-row small { grid-column: 1 / -1; color: var(--pi-muted); overflow-wrap: anywhere; }
      .updates-command { min-width: 0; display: grid; grid-template-columns: 150px minmax(0, 1fr) auto; gap: 8px; align-items: center; }
      .updates-command code { overflow: auto; border: 1px solid var(--pi-border-muted); border-radius: 6px; background: var(--pi-bg); padding: 5px 7px; white-space: nowrap; }
      .updates-command-actions { display: inline-flex; gap: 6px; }
      .updates-recommended { border: 1px solid var(--pi-accent-border); border-radius: 8px; padding: 10px; background: var(--pi-surface); }
      .updates-recommended > strong { color: var(--pi-text-bright); }
      .updates-recommended .updates-message { border: none; background: none; padding: 0; }
      .updates-meta { display: grid; gap: 2px; color: var(--pi-muted); font-size: 12px; overflow-wrap: anywhere; }
      @container (max-width: 520px) {
        .updates-command { grid-template-columns: minmax(0, 1fr); }
        .updates-command-actions { justify-self: start; }
      }
    </style>
    <section class="ui-toolbar updates-toolbar"><strong class="ui-toolbar-title">${t("bundled.updates.updates.3055a0", "Updates")}</strong>${messages.length > 0 ? html`<span class="stale">${String(messages.length)}</span>` : null}</section>
    <section class="viewer updates-status">
      ${recommended === undefined ? renderNotices(html, messages) : renderRecommended(html, terminal, recommended, messages)}

      <section>
        <strong>${t("bundled.updates.installed.services.ef70c6", "Installed services")}</strong>
        ${renderComponent(html, status.components.web)}
        ${renderComponent(html, status.components.sessiond)}
      </section>

      ${renderAdditionalCommands(html, terminal, additional, recommended !== undefined)}

      <section class="updates-meta">
        <span>${t("ui.main.2213d2e64aff", "Generated")} ${status.generatedAt}</span>
        ${status.release.latestVersion === undefined ? null : html`<span>${t("ui.main.f7047c4cb0e0", "Latest npm release")} ${status.release.latestVersion}</span>`}
        ${status.release.checkedAt === undefined || status.release.skipped === true ? null : html`<span>${t("ui.main.58006f4511ed", "Release checked")} ${status.release.checkedAt}</span>`}
        ${status.release.skipped === true ? html`<span>${t("bundled.updates.remote.version.check.skipped.66de71", "Remote version check skipped.")}</span>` : null}
        ${status.release.error === undefined ? null : html`<span>${t("ui.main.30c7a262a7d1", "Remote version check failed:")}${status.release.error}</span>`}
      </section>
    </section>
  `;
}

function severityLabel(severity: string): string {
  if (severity === "warning") return t("client.sessionNotifications.warning.a8b7a4", "Warning");
  if (severity === "error") return t("client.sessionNotifications.error.0bc1fb", "Error");
  return severity;
}

const plugin = {
  apiVersion: 4,
  name: t("bundled.updates.updates.3055a0", "Updates"),
  activate: ({ html, svg, translate }) => { setTranslator(translate); return ({
    contributions: {
      actions: [
        {
          id: "check",
          title: t("bundled.updates.check.for.pi.web.updates.2062d8", "Check for PI WEB updates"),
          description: t("bundled.updates.check.the.selected.machine.now.ignoring.cached.release.informatio.e12ea5", "Check the selected machine now, ignoring cached release information"),
          group: t("bundled.updates.updates.3055a0", "Updates"),
          enabled: (context) => context.checkForPiWebUpdates !== undefined,
          disabledReason: () => t("bundled.updates.checking.for.updates.requires.a.newer.pi.web.gateway.0a72c8", "Checking for updates requires a newer PI WEB gateway"),
          run: (context) => context.checkForPiWebUpdates?.(),
        },
      ],
      applicationPanels: [
        {
          id: "workspace.updates",
          title: t("bundled.updates.updates.3055a0", "Updates"),
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
  }); },
} satisfies PiWebPlugin;

export default plugin;

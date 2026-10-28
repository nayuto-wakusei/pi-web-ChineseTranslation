import { t, setTranslator } from "./i18n.js";
import type { TemplateResult } from "lit";
import type { HtmlTemplateTag, PiWebComponentStatus, PiWebPlugin, PiWebStatusMessage, PluginRuntimeState, MaintenanceTerminal, PluginLocalization, PiWebInstallationInfo, PiWebStatusResponse } from "@chainingintention/pi-web-cn/plugin-api";
import { additionalCommands, fallbackDockerStatus, messageCount, recommendedCommand, shouldShowUpdatesPanel, statusFor, type CommandEntry, type UpdatesRuntimeHint } from "./updatesLogic.js";

import definitions from "./updates.messages.js";

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


function createUpdatesContent(localization: PluginLocalization) {
  const messages = localization.registerMessages("panel", definitions);
  const t: typeof messages.t = messages.t.bind(messages);
  const formatVersion = (version: string | undefined): string => version === undefined || version === "" ? t("unknown") : version;
  const installationLabel = (installation: PiWebInstallationInfo | undefined): string => {
    if (installation?.kind === "pi-package") return localization.list([installation.source ?? t("piPackage"), ...(installation.scope === undefined ? [] : [installation.scope])]);
    if (installation?.kind === "npm-global") return t("npmGlobal");
    if (installation?.kind === "local") return t("local");
    if (installation?.kind === "docker") return t(installation.dockerMode === "dev" ? "dockerDev" : "docker");
    return t("installationUnknown");
  };
  const timestamp = (raw: string): string => {
    const value = Date.parse(raw);
    return Number.isNaN(value) ? t("statusUnavailable") : localization.date(value, { dateStyle: "medium", timeStyle: "short" });
  };

  function runCommandInTerminal(terminal: MaintenanceTerminal, label: string, command: string): void {
    void terminal.runCommand({
      title: label,
      command,
      open: true,
      metadata: { "pi.plugin": "updates" },
    }).catch((error: unknown) => {
      console.error(`Updates plugin failed to run "${label}"`, error);
    });
  }

  function renderComponent(html: HtmlTemplateTag, component: PiWebComponentStatus): TemplateResult {
    const status = !component.available
      ? t("unavailable")
      : component.stale
        ? t("restartNeeded")
        : t("current");
    return html`
      <div class="updates-version-row">
        <strong>${t(component.component === "web" ? "web" : "sessiond")}</strong>
        <span>${status}</span>
        <small>${t("versions", { running: formatVersion(component.runtimeVersion), installed: formatVersion(component.installedVersion) })}</small>
        <small>${installationLabel(component.installation)}${component.installation?.path === undefined ? "" : ` · ${component.installation.path}`}</small>
      </div>
    `;
  }

  function renderCommandActions(html: HtmlTemplateTag, terminal: MaintenanceTerminal | undefined, label: string, command: string): TemplateResult {
    return html`
      <span class="updates-command-actions">
        <button type="button" class="ui-button ui-button--action ui-button--compact" .textContent=${t("copy")} @click=${(event?: Event) => { void copyCommandToClipboard(command, event?.currentTarget); }}></button>
        ${terminal === undefined ? null : html`<button type="button" class="ui-button ui-button--action ui-button--compact ui-button--primary" @click=${() => { runCommandInTerminal(terminal, label, command); }}>${t("run")}</button>`}
      </span>
    `;
  }

  function renderCommand(html: HtmlTemplateTag, terminal: MaintenanceTerminal | undefined, label: string, command: string): TemplateResult {
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

  // Status notices never carry their own command row: every command a notice can
  // reference already appears exactly once in this panel — either as the single
  // recommended action or in the optional commands list — so the panel never
  // presents two competing prominent actions for the same situation.
  function localizeNotice(message: PiWebStatusMessage, status: PiWebStatusResponse): PiWebStatusMessage {
    const versions = (component: PiWebComponentStatus) => ({ running: formatVersion(component.runtimeVersion), installed: formatVersion(component.installedVersion) });
    switch (message.id) {
      case "update-available": {
        const installed = status.components.web.installedVersion ?? status.components.web.runtimeVersion;
        return { ...message, title: t("updateTitle"), body: t("updateBody", { latest: status.release.latestVersion ?? t("unknown"), installed: installed ?? "", known: installed === undefined ? "no" : "yes", command: status.commands.update === undefined ? "no" : "yes" }) };
      }
      case "web-stale": return { ...message, title: t("webTitle"), body: t("webBody", versions(status.components.web)) };
      case "sessiond-stale": return { ...message, title: t("sessiondTitle"), body: t("sessiondBody", versions(status.components.sessiond)) };
      case "sessiond-unavailable": return { ...message, title: t("unavailableTitle"), body: t("unavailableBody", { hasError: status.components.sessiond.error === undefined ? "no" : "yes", error: status.components.sessiond.error ?? "" }) };
      case "docker-status-compatibility": return { ...message, title: t("dockerTitle"), body: t("dockerBody") };
      // Future gateways can add notices unknown to this client. Keep their data
      // visible rather than guessing at its meaning or dropping safety guidance.
      default: return message;
    }
  }

  function renderNotice(html: HtmlTemplateTag, message: PiWebStatusMessage): TemplateResult {
    return html`
      <article class=${`updates-message ${message.severity}`}>
        <div class="updates-message-title"><strong>${message.title}</strong><span>${t(message.severity)}</span></div>
        <p>${message.body}</p>
      </article>
    `;
  }

  function renderNotices(html: HtmlTemplateTag, messages: readonly PiWebStatusMessage[]): TemplateResult {
    return html`
      <section>
        ${messages.length === 0 ? html`<p class="muted">${t("noMessages")}</p>` : messages.map((message) => renderNotice(html, message))}
      </section>
    `;
  }

  function renderRecommended(html: HtmlTemplateTag, terminal: MaintenanceTerminal | undefined, recommended: CommandEntry, messages: readonly PiWebStatusMessage[]): TemplateResult {
    return html`
      <section class="updates-recommended">
        <strong>${t("recommended")}</strong>
        ${messages.length === 0
          ? html`<p class="muted">${t("recommendedHelp")}</p>`
          : messages.map((message) => renderNotice(html, message))}
        ${renderCommand(html, terminal, recommended.label, recommended.command)}
      </section>
    `;
  }

  function renderAdditionalCommands(html: HtmlTemplateTag, terminal: MaintenanceTerminal | undefined, additional: readonly CommandEntry[], hasRecommended: boolean): TemplateResult | undefined {
    if (additional.length === 0) return undefined;
    return html`
      <section>
        <strong>${t(hasRecommended ? "additional" : "suggested")}</strong>
        ${hasRecommended ? html`<p class="muted">${t("additionalHelp")}</p>` : null}
        ${additional.map((entry) => renderCommand(html, terminal, entry.label, entry.command))}
      </section>
    `;
  }

  function renderUpdatesPanel(html: HtmlTemplateTag, terminal: MaintenanceTerminal | undefined, state: PluginRuntimeState | undefined): TemplateResult {
    const status = statusFor(state) ?? fallbackDockerStatus(runtimeHint);
    if (status === undefined) {
      return html`
        <section class="ui-toolbar"><strong class="ui-toolbar-title">${t("updates")}</strong></section>
        <section class="viewer"><p class="muted">${t("checking")}</p></section>
      `;
    }

    const messages = status.messages.map((notice) => localizeNotice(notice, status));
    const recommended = recommendedCommand(status, (key) => t(key));
    const additional = additionalCommands(status, recommended, (key) => t(key));
    return html`
      <style>
        .updates-toolbar { flex: 0 0 auto; padding-inline: 12px; }
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
      <section class="ui-toolbar updates-toolbar"><strong class="ui-toolbar-title">${t("updates")}</strong>${messages.length > 0 ? html`<span class="stale">${localization.number(messages.length)}</span>` : null}</section>
      <section class="viewer updates-status">
        ${recommended === undefined
          ? renderNotices(html, messages)
          : renderRecommended(html, terminal, recommended, messages)}

        <section>
          <strong>${t("services")}</strong>
          ${renderComponent(html, status.components.web)}
          ${renderComponent(html, status.components.sessiond)}
        </section>

        ${renderAdditionalCommands(html, terminal, additional, recommended !== undefined)}

        <section class="updates-meta">
          <span>${t("generated", { time: timestamp(status.generatedAt) })}</span>
          ${status.release.latestVersion === undefined ? null : html`<span>${t("latest", { version: status.release.latestVersion })}</span>`}
          ${status.release.checkedAt === undefined || status.release.skipped === true ? null : html`<span>${t("checked", { time: timestamp(status.release.checkedAt) })}</span>`}
          ${status.release.skipped === true ? html`<span>${t("skipped")}</span>` : null}
          ${status.release.error === undefined ? null : html`<span>${t("failed", { error: status.release.error })}</span>`}
        </section>
      </section>
    `;
  }

  return { messages, renderUpdatesPanel, runtimeHint };
}

const plugin = {
  apiVersion: 4,
  name: "Updates",
  activate: ({ html, svg, localization, translate }) => {
    setTranslator(translate);
    if (localization === undefined) throw new Error("Updates requires a localization-capable PI WEB host");
    const { messages, renderUpdatesPanel, runtimeHint } = createUpdatesContent(localization);
    return {
      contributions: {
        actions: [
          {
            id: "check",
            get title() { return messages.t("check"); },
            get description() { return messages.t("checkDescription"); },
            get group() { return messages.t("updates"); },
            enabled: (context) => context.checkForPiWebUpdates !== undefined,
            disabledReason: () => messages.t("disabled"),
            run: (context) => context.checkForPiWebUpdates?.(),
          },
        ],
        applicationPanels: [
          {
            id: "workspace.updates",
            get title() { return messages.t("updates"); },
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
            render: (context) => renderUpdatesPanel(html, context.maintenanceTerminal, context.state),
          },
        ],
      },
    };
  },
} satisfies PiWebPlugin;

export default plugin;

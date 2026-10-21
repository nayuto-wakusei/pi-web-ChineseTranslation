import { t } from "../../i18n.js";
import type { PluginActivationContext, WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";
import type { LogEntry } from "./protocol.js";
import { renderCaptainMarkdown } from "./markdown.js";

type Html = PluginActivationContext["html"];
export interface SourceSession { id: string; name: string }
export function selectedSourceSession(context: WorkspacePanelContext): SourceSession | undefined {
  if (context.state?.selectedMachine && context.state.selectedMachine.id !== context.machine.id) return;
  const selected = context.state?.selectedSession;
  if (!selected || selected.archived || selected.pending || selected.cwd !== context.workspace.path) return;
  return { id: selected.id, name: selected.name !== undefined && selected.name.trim() !== "" ? selected.name : t("ui.main.19976e58bf31", "Session {arg0}", { arg0: selected.id.slice(0, 8) }) };
}
export interface CaptainPanelView {
  entries: LogEntry[]; selected?: LogEntry; status: string;
  connected: boolean; connecting: boolean; pending: boolean;
  source?: SourceSession;
  notice?: string;
  machineName: string;
  onTranslate: () => void;
  onReconnect: () => void;
  onRead(id: string): void;
  onOpenSource(id: string): void;
}
export function captainStatusLabel(status: LogEntry["status"]): string {
  return { running: t("ui.main.fcb979ef0b91", "Working"), completed: t("ui.main.e99b48a29bdf", "Done"), failed: t("ui.toolExecutionView.failed", "Failed"), interrupted: t("ui.main.8dd5ad764e4b", "Interrupted") }[status];
}

const stageLabels: Readonly<Record<string, string>> = {
  "Backend admitted translation": t("ui.main.21e0dc881126", "Backend accepted the relay request"),
  "Backend sent request to native companion": t("ui.main.269ce066984c", "Backend sent the request to the native companion extension"),
  "Native companion received request": t("ui.main.2666275c64be", "Native companion extension received the request"),
  "Native Pi agent running": t("ui.main.880fe7bb6b95", "Native Pi agent is running"),
  "Backend received correlated final reply": t("ui.main.a7da535ace12", "Backend received the final reply matching the request"),
  "Source reply read without changing source": t("ui.main.0883bfa9c8ef", "Source reply read; source session unchanged"),
  "Pirate conversation selected": t("ui.main.9def3f08ac2e", "Captain session selected"),
  "Backend recorded failure (not success)": t("ui.main.157309c7e4ca", "Backend recorded a failure, not a successful result"),
  "Backend saved completed roundtrip": t("ui.main.f33a027a96b7", "Backend saved the completed result"),
};
const errorLabels: Readonly<Record<string, string>> = {
  "Captain is already working.": t("ui.main.09d17019ed2e", "Captain is working; wait for the current relay to complete."),
  "Select a source session other than the pirate conversation.": t("ui.main.e4e81b805cf5", "Choose another source session; the Captain session cannot relay itself."),
  "Selected session is not hosted in this workspace on this machine": t("ui.main.17dbe57aba6b", "The selected session is not running in this workspace on the current machine."),
  "Source session must be idle with no pending messages. Wait for it to finish, then translate again.": t("ui.main.977c98d1294e", "The source session must be idle with no pending messages. Wait for it to finish before relaying."),
  "Source session has no completed assistant text reply on its active branch.": t("ui.main.14ddd1ef21f6", "The current source branch has no completed assistant text reply."),
  "Source reply exceeds the translation limit (48000 characters).": t("ui.main.eed449c7ce8e", "The source reply exceeds the relay limit of 48000 characters."),
  "Companion not ready or session busy; open Captain's Log in Sessions, wait for idle, then retry": t("ui.main.c562cb9f79cb", "The companion extension is not ready or the session is busy. Open the Captain session and wait until idle before retrying."),
  "Captain request interrupted by session shutdown or reload": t("ui.main.08ad1fcd5abc", "Closing or reloading the session interrupted the Captain request."),
  "Another prompt interfered with this Captain request; translation was not saved": t("ui.main.ba11baa65750", "Another prompt interfered with the Captain request; the relay result was not saved."),
  "Another user message interfered with this Captain request": t("ui.main.da152c51dbd7", "Another user message interfered with the Captain request."),
  "Captain request error": t("ui.main.09896d6c5119", "The Captain request encountered an error."),
  "Captain request aborted": t("ui.main.cf3f914e3924", "The Captain request was aborted."),
  "Captain request failed": t("ui.main.b34409c59ab5", "The Captain request failed."),
  "Captain request ended without a successful final text response": t("ui.main.e5b2393b01a1", "The Captain request ended without a successful final text reply."),
  "Captain reply exceeded the storage limit": t("ui.main.3ea3beebb303", "The Captain reply exceeds the storage length limit."),
  "Invalid translation text": t("ui.main.6f70b118900c", "Invalid relay text."),
  "Invalid companion reply": t("ui.main.af43aa465d0a", "Invalid companion extension reply."),
  "Captain connection interrupted; agent work may continue in Sessions": t("ui.main.dc807ddd54fa", "The Captain connection was interrupted; the agent may still be working in the session."),
  "No companion receipt within 5 seconds. Check package enablement/trust; inspect Sessions before retrying.": t("ui.main.afdcdd4b929c", "No companion acknowledgement arrived within 5 seconds. Check that the package is enabled and trusted, and inspect the session before retrying."),
  "Captain request exceeded 10 minutes; agent work may continue in Sessions. No translation saved.": t("ui.main.d2cd15752866", "The Captain request exceeded 10 minutes. The agent may still be working; the relay result was not saved."),
  "Captain's Log stopped before recording completion. Inspect the previous session before retrying. Nothing was resent automatically.": t("ui.main.b8e0a313e94a", "Captain's Log stopped before recording a completed result. Inspect the previous session before retrying; no request was resent automatically."),
};
function displayCaptainError(text: string): string {
  const prefix = "Captain could not finish this request. Inspect the session before retrying; nothing was resent automatically.\n";
  if (text.startsWith(prefix)) return t("ui.main.250d9fb3b162", "Captain could not complete the request. Inspect the session before retrying; no request was resent automatically.\n{arg0}", { arg0: displayCaptainError(text.slice(prefix.length)) });
  const message = text.startsWith("Error: ") ? text.slice(7) : text;
  return errorLabels[message] ?? text;
}
function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function renderCaptainPanel(html: Html, view: CaptainPanelView) {
  const working = view.entries.some((entry) => entry.status === "running");
  const pirateSelected = view.source !== undefined && view.entries.some((entry) => entry.sessionId === view.source?.id);
  const disabled = !view.connected || view.connecting || view.pending || working || !view.source || pirateSelected;
  const selected = view.selected;
  const sourceSessionId = selected?.sourceSessionId;
  const status = view.connecting ? t("ui.main.9d02d121573c", "Connecting…") : !view.connected ? t("ui.main.570f6d331cce", "Connection lost") : view.pending ? t("ui.main.482617a8c265", "Fetching the last reply…")
    : working ? t("ui.main.c13e5f4963ff", "The captain is translating…") : !view.source ? t("ui.main.3c86e23d60ea", "Select a session in this workspace first.") : pirateSelected ? t("ui.main.80a96f7d125e", "Select a different session — this one is the pirate.")
      : t("ui.main.12fc65d7525d", "Ready to translate");
  return html`<style>${styles}</style>
    <section class="captains-log" aria-label="${t("ui.main.40c450439267", "Captain's Log")}">
      <div class="captain-heading"><h2>${t("ui.main.e841f99d77f0", "Captain's Log")}</h2><p class="muted">${t("ui.main.1c3532df737d", "Have a dramatic pirate captain relay the last reply.")}</p></div>
      <div class="captain-source"><span class="muted">${t("ui.main.84521ab1f774", "Selected session")}</span><strong>${view.source?.name ?? t("ui.sessionList.noSessionSelected", "No session selected")}</strong></div>
      <button class="captain-primary" ?disabled=${disabled} @click=${view.onTranslate}>${t("ui.main.09ee4046866f", "Let the Captain tell it")}</button>
      <p class="captain-status" role="status" aria-live="polite">${status}
        ${!view.connected && !view.connecting ? html`<button @click=${view.onReconnect}>${t("ui.main.bac95e1e52fe", "Reconnect")}</button>` : null}
      </p>
      ${!view.connected && !view.connecting ? html`<p class="captain-notice">${t("ui.main.3c3a8d4bb0ab", "Reconnect to see the result. The captain may still be working; your request will not be sent again.")}</p>` : null}
      ${view.notice !== undefined && view.notice !== "" ? html`<p class="captain-notice" role="alert">${displayCaptainError(view.notice)}</p>` : null}
      ${selected ? html`<article class="captain-reply" aria-label="${t("ui.main.e572c45a01a6", "Pirate translation")}">
        <div class="captain-reply-heading"><strong>${selected.status === "running" ? t("ui.main.a3e678a94720", "Translating…") : selected.id === view.entries[0]?.id ? t("ui.main.aa1bf7a5ddbe", "Last translation") : t("ui.main.91515d50cc9e", "Earlier translation")}</strong><time datetime=${selected.createdAt}>${dateLabel(selected.createdAt)}</time></div>
        ${selected.status === "completed" ? html`<div class="captain-answer">${selected.text ? renderCaptainMarkdown(html, selected.text) : t("ui.main.648d8128e3c7", "Receiving the captain's reply…")}</div>`
          : selected.status === "running" ? html`<p class="muted">${t("ui.main.c61214cbad46", "Reading the source reply and turning it into pirate. No message is sent to the source conversation.")}</p>`
            : html`<div class="captain-notice" role="alert"><strong>${selected.status === "interrupted" ? t("ui.main.8ac60a0f0b8e", "Translation interrupted") : t("ui.main.fe0e672c27d4", "Couldn't translate that reply")}</strong><p>${displayCaptainError(selected.text) || t("ui.main.72a4ca9f0124", "Check Diagnostics for details, then try again when the session is ready.")}</p></div>`}
        ${sourceSessionId !== undefined && sourceSessionId !== "" ? html`<button @click=${() => { view.onOpenSource(sourceSessionId); }}>${t("ui.main.58ea40f79134", "Open source session")}</button>` : null}
      </article>` : html`<p class="captain-empty muted">${t("ui.main.34a6d480c665", "Pick a conversation, then translate its latest finished assistant reply. The original stays untouched.")}</p>`}
      <div class="captain-secondary">
        ${view.entries.length > 1 ? html`<details><summary>${t("ui.main.91515d50cc9e", "Earlier translation")} <span class="muted">(${view.entries.length})</span></summary>
          <div class="captain-history">${view.entries.map((entry) => html`<button class=${entry.id === selected?.id ? "selected" : ""} ?disabled=${!view.connected} @click=${() => { view.onRead(entry.id); }}>
            <span>${dateLabel(entry.createdAt)} · ${entry.status === "completed" ? t("ui.main.9f66d2a4d6f7", "Translated") : entry.status === "running" ? t("ui.main.fcb979ef0b91", "Working") : t("ui.main.b61b08aec3a9", "Not completed")}</span>
          </button>`)}</div>
        </details>` : null}
        <details class="captain-diagnostics"><summary>${t("ui.main.e0b478941707", "Diagnostics")}</summary>
          <p>${displayCaptainError(view.status)}</p>
          ${selected ? html`<dl><dt>${t("bundled.info.machine.ece969", "Machine")}</dt><dd>${view.machineName}</dd><dt>${t("ui.main.b92dc0c2297a", "Source session")}</dt><dd>${selected.sourceSessionId ?? t("bundled.updates.unknown.4d8c1c", "Unknown")}</dd><dt>${t("ui.main.62b811ff4549", "Pirate session")}</dt><dd>${selected.sessionId || t("ui.main.db03d9974969", "Not created")}</dd><dt>${t("ui.main.926f6b6b6a93", "Request")}</dt><dd>${selected.id}</dd></dl>
            <p>${selected.question === "Translate last reply" ? t("ui.main.fc69d95b95b3", "Relay the last reply") : selected.question}</p><ol>${selected.stages.map((stage) => html`<li>${stageLabels[stage] ?? stage}</li>`)}</ol>` : null}
        </details>
        <p class="captain-footnote muted">${t("ui.main.8dbbd44d148a", "Uses your configured model. Reuses the pirate while it's available; otherwise starts one automatically.")}</p>
      </div>
    </section>`;
}
// Light DOM inherits workspace typography/buttons. Extra rules are package-scoped and use host themes.
const styles = `
  captains-log-lifetime { display: block; min-width: 0; }
  .captains-log { box-sizing: border-box; padding: 16px; min-width: 0; color: inherit; font: inherit; line-height: 1.5; }
  .captains-log *, .captains-log *::before, .captains-log *::after { box-sizing: border-box; }
  .captains-log h2, .captains-log p { margin: 0; }
  .captains-log h2 { font-size: 15px; }
  .captains-log button { font: inherit; }
  .captains-log button:hover:not(:disabled) { background: var(--pi-surface-hover); }
  .captains-log button:disabled { opacity: .5; cursor: not-allowed; }
  .captains-log button:focus-visible, .captains-log summary:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
  .captains-log .captain-primary { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); padding: 8px 12px; }
  .captains-log .captain-source { display: grid; gap: 3px; margin: 18px 0 12px; padding: 10px 12px; background: var(--pi-surface); border: 1px solid var(--pi-border-muted); border-radius: 8px; overflow-wrap: anywhere; }
  .captains-log .captain-source span { font-size: 11px; }
  .captains-log .captain-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 10px 0 16px; color: var(--pi-muted); font-size: 12px; }
  .captains-log .captain-notice { padding: 12px; margin-bottom: 12px; border: 1px solid var(--pi-warning-border); border-radius: 8px; background: var(--pi-warning-surface); overflow-wrap: anywhere; white-space: pre-wrap; }
  .captains-log .captain-notice p { margin-top: 6px; }
  .captains-log .captain-empty { padding: 16px 0; }
  .captains-log .captain-reply { padding: 16px 0; border-top: 1px solid var(--pi-border-muted); }
  .captains-log .captain-reply-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .captains-log time { color: var(--pi-muted); font-size: 11px; }
  .captains-log .captain-answer { line-height: 1.65; overflow-wrap: anywhere; min-width: 0; }
  .captains-log .captain-answer > :first-child { margin-top: 0; }
  .captains-log .captain-answer > :last-child { margin-bottom: 0; }
  .captains-log .captain-answer p, .captains-log .captain-answer ul, .captains-log .captain-answer ol { margin: .65em 0; }
  .captains-log .captain-answer h1, .captains-log .captain-answer h2, .captains-log .captain-answer h3,
  .captains-log .captain-answer h4, .captains-log .captain-answer h5, .captains-log .captain-answer h6 { margin: 1em 0 .4em; line-height: 1.3; }
  .captains-log .captain-answer h1 { font-size: 1.5em; }
  .captains-log .captain-answer h2 { font-size: 1.3em; }
  .captains-log .captain-answer h3 { font-size: 1.15em; }
  .captains-log .captain-answer ul, .captains-log .captain-answer ol { padding-left: 1.7em; }
  .captains-log .captain-answer blockquote { margin: .75em 0; padding-left: 1em; border-left: 3px solid var(--pi-border-muted); color: var(--pi-muted); }
  .captains-log .captain-answer code { font-family: monospace; background: var(--pi-surface); border-radius: 3px; padding: .1em .25em; }
  .captains-log .captain-answer pre { max-width: 100%; overflow: auto; padding: 12px; background: var(--pi-surface); border: 1px solid var(--pi-border-muted); border-radius: 6px; white-space: pre; overflow-wrap: normal; }
  .captains-log .captain-answer pre code { padding: 0; background: none; }
  .captains-log .captain-answer a { color: var(--pi-accent); text-decoration: underline; }
  .captains-log .captain-answer a:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
  .captains-log .captain-table-scroll { max-width: 100%; overflow: auto; margin: .75em 0; }
  .captains-log .captain-answer table { border-collapse: collapse; width: 100%; }
  .captains-log .captain-answer th, .captains-log .captain-answer td { border: 1px solid var(--pi-border-muted); padding: 6px 10px; text-align: left; }
  .captains-log .captain-answer th { background: var(--pi-surface); }
  .captains-log .captain-answer hr { border: 0; border-top: 1px solid var(--pi-border-muted); }
  .captains-log .captain-secondary { border-top: 1px solid var(--pi-border-muted); margin-top: 12px; padding-top: 6px; }
  .captains-log details { padding: 8px 0; }
  .captains-log summary { cursor: pointer; color: var(--pi-muted); }
  .captains-log details p { margin: 8px 0; overflow-wrap: anywhere; }
  .captains-log .captain-history { display: grid; gap: 6px; padding-top: 8px; }
  .captains-log .captain-history button { text-align: left; min-width: 0; }
  .captains-log dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; font-size: 11px; }
  .captains-log dd { margin: 0; overflow-wrap: anywhere; }
  .captains-log .captain-footnote { font-size: 11px; margin-top: 10px; }
`;

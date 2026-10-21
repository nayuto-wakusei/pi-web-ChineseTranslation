import { css, svg, type TemplateResult } from "lit";
import type { AskUserOutcome } from "../../../shared/apiTypes";
import type { SessionWarningSeverity } from "../api";

/** Shared downstream shadow for content passing beneath sticky scroll controls. */
export const scrollHideShadow = css`0 8px 18px var(--pi-shadow-soft)`;

export function renderSessionWarningIcon(severity: SessionWarningSeverity, className: string): TemplateResult {
  if (severity === "error") {
    return svg`
      <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="m15 9-6 6"></path>
        <path d="m9 9 6 6"></path>
      </svg>
    `;
  }
  if (severity === "info") {
    return svg`
      <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M12 11v5"></path>
        <path d="M12 8h.01"></path>
      </svg>
    `;
  }
  return svg`
    <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.3 3.7 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"></path>
      <path d="M12 9v4"></path>
      <path d="M12 17h.01"></path>
    </svg>
  `;
}

export interface ToolPreview {
  diff?: string;
  firstChangedLine?: number;
  error?: string;
}

export interface ToolExecutionPart {
  type: "toolExecution";
  toolCallId?: string;
  toolName: string;
  summary: string;
  args?: unknown;
  status: "pending" | "running" | "success" | "error";
  resultText?: string;
  content?: unknown;
  details?: unknown;
  preview?: ToolPreview;
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "thinking"; text: string }
  | { type: "skillInvocation"; name: string; location: string; content: string }
  | { type: "skillRead"; name: string; path: string; toolCallId?: string }
  | { type: "askUserRecord"; outcome: AskUserOutcome }
  | { type: "toolCall"; toolCallId?: string; toolName: string; summary: string; args?: unknown }
  | ToolExecutionPart
  | { type: "toolResult"; toolCallId?: string; toolName: string; text: string; isError: boolean; content?: unknown; details?: unknown }
  | { type: "empty" };

export interface ChatLine {
  /** Durable session-tree entry; absent for optimistic or in-flight messages. */
  entryId?: string;
  transcriptIndex?: number;
  role: "user" | "assistant" | "tool" | "system" | "bash" | "skill";
  parts: ChatPart[];
  source?: "compaction" | "branch_summary";
  meta?: {
    timestamp?: string;
    model?: { provider?: string; id?: string; responseId?: string };
    /** Thinking level the assistant message was generated with, when known. */
    thinkingLevel?: string;
  };
}

export interface CompletionItem {
  kind: "command" | "file" | "model";
  replaceFrom: number;
  replaceTo: number;
  insertText: string;
  detail: string;
  description?: string;
  /** Pi-style argument hint (e.g. `<PR-URL>`) for commands that declare one. */
  argumentHint?: string;
  cursorOffset?: number;
}

export const chatStyles = css`
  :host { position: relative; z-index: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  .chat-wrap { position: relative; flex: 1 1 0; min-height: 0; max-height: 100%; overflow: hidden; }
  .top-notices { box-sizing: border-box; flex: 0 0 auto; max-height: 40%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg-overlay); }
  .session-warnings { flex: 0 1 auto; display: grid; gap: 8px; max-height: 50%; min-height: 0; overflow-y: auto; box-sizing: border-box; padding: 10px 16px; border-bottom: 1px solid var(--pi-border-muted); }
  .session-warnings:only-child { flex: 1 1 auto; max-height: 100%; border-bottom: 0; }
  .session-warnings-controls { display: flex; justify-content: flex-end; }
  .session-warnings-collapse { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); padding: 4px 7px; font: 12px system-ui, sans-serif; cursor: pointer; }
  .session-warnings-collapse:hover, .session-warnings-collapse:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); background: var(--pi-bg-overlay); }
  .session-warnings-collapse:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  .session-warnings-collapse-icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .session-warning { position: relative; display: grid; gap: 4px; box-sizing: border-box; padding: 10px 34px 10px 12px; border: 1px solid var(--pi-warning-border); border-radius: 10px; background: var(--pi-warning-surface); color: var(--pi-text); }
  .session-warning.error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 12%, var(--pi-surface)); }
  .session-warning.info { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
  .session-warning-head { display: flex; align-items: center; gap: 8px; min-height: 16px; }
  .session-warning-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .session-warning-body { min-width: 0; display: grid; gap: 3px; }
  .session-warning-message { margin: 0; overflow-wrap: anywhere; }
  .session-warning-path { margin: 0; color: var(--pi-muted); font-size: 12px; font-family: var(--pi-mono, ui-monospace, monospace); overflow-wrap: anywhere; }
  .session-warning-source { color: var(--pi-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .session-warning-dismiss { position: absolute; top: 6px; right: 6px; display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); font: 15px/1 system-ui, sans-serif; cursor: pointer; }
  .session-warning-dismiss:hover, .session-warning-dismiss:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); background: var(--pi-bg-overlay); }
  .session-warning-dismiss:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  .notification-tray { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--pi-bg-overlay); }
  .notification-tray.collapsed { flex: 0 0 auto; }
  .notification-header { position: sticky; top: 0; z-index: 2; flex: 0 0 auto; min-width: 0; display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 8px; box-sizing: border-box; min-height: 40px; padding: 4px 10px; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg-overlay); }
  .notification-tray.collapsed .notification-header { border-bottom: 0; }
  .notification-header:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -3px; }
  .notification-heading { min-width: 0; flex: 1 1 auto; overflow: hidden; color: var(--pi-text-bright); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .notification-header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
  .notification-control, .notification-row-dismiss { box-sizing: border-box; min-height: 32px; border: 0; border-radius: 6px; background: transparent; color: var(--pi-muted); cursor: pointer; }
  .notification-control { padding: 0 7px; font: 12px system-ui, sans-serif; white-space: nowrap; }
  .notification-toggle { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; }
  .notification-control:hover, .notification-control:focus-visible, .notification-row-dismiss:hover, .notification-row-dismiss:focus-visible { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
  .notification-control:focus-visible, .notification-row-dismiss:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
  .notification-control:disabled, .notification-row-dismiss:disabled { opacity: .5; background: transparent; cursor: default; }
  .notification-icon { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .notification-disclosure-icon.expanded { transform: rotate(90deg); }
  .notification-close-icon { width: 16px; height: 16px; }
  .notification-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; box-sizing: border-box; padding: 0 10px 5px; }
  .notification-list[hidden] { display: none; }
  .notification-overflow { margin: 0; padding: 7px 2px; border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
  .notification-row { position: relative; min-width: 0; display: grid; gap: 4px; box-sizing: border-box; padding: 9px 38px 9px 2px; border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-text); }
  .notification-row:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
  .notification-metadata { min-width: 0; display: flex; align-items: baseline; gap: 5px; color: var(--pi-muted); font-size: 11px; }
  .notification-severity { color: var(--pi-muted); font-size: inherit; font-weight: 600; }
  .notification-row.warning .notification-severity { color: var(--pi-warning); }
  .notification-row.error .notification-severity { color: var(--pi-danger); }
  .notification-message { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; text-align: start; unicode-bidi: plaintext; }
  .notification-truncated { margin: 0; color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
  .notification-row-dismiss { position: absolute; top: 5px; right: 0; display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; }
  .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important; }
  .notification-live span { display: block; }
  @media (pointer: coarse) {
    .notification-control, .notification-row-dismiss { min-height: 34px; }
    .notification-toggle, .notification-row-dismiss { width: 34px; height: 34px; }
    .notification-row { padding-right: 40px; }
  }
  @media (max-width: 520px) {
    .notification-header { gap: 4px; padding-inline: 8px; }
    .notification-list { padding-inline: 8px; }
  }
  .chat { --pi-chat-sticky-top: -26px; position: absolute; inset: 0; min-height: 0; overflow: auto; overflow-anchor: none; padding: 26px 16px 64px; box-sizing: border-box; }
  .scroll-marker { display: block; height: 0; overflow: hidden; pointer-events: none; }
  .activity-dock { position: absolute; left: 16px; right: 16px; bottom: 12px; z-index: 20; display: flex; align-items: center; gap: 8px; min-width: 0; box-sizing: border-box; border: 1px solid var(--pi-border); border-radius: 999px; background: var(--pi-bg-overlay); color: var(--pi-muted); padding: 8px 12px; font-size: 13px; pointer-events: none; box-shadow: 0 8px 28px var(--pi-shadow); backdrop-filter: blur(6px); }
  .activity-dock.active { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-bg-overlay); }
  .activity-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .45; flex: 0 0 auto; }
  .activity-dock.active .dot { animation: pulse 1s ease-in-out infinite; opacity: 1; }
  .msg { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; margin: 0 0 14px; padding: 12px; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); overflow: visible; }
  .msg.assistant, .msg.tool-image-output { background: var(--pi-surface); }
  .msg.user { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
  .msg.tool { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); color: var(--pi-warning); }
  .msg.tool-execution-shell, .msg.ask-user-record-shell { padding: 0; border: 0; background: transparent; color: var(--pi-text); }
  .msg.ask-user-record-shell ask-user-card { margin: 0 auto; }
  .msg.system { color: var(--pi-danger); }
  .msg.bash { border-color: var(--pi-success); background: var(--pi-success-bg); }
  .msg.skill { border-color: var(--pi-purple-border); background: var(--pi-purple-surface); }
  .msg.event-group { padding: 0; border-color: var(--pi-border); background: var(--pi-bg); color: var(--pi-muted); }
  .msg.event-group.live { border-color: var(--pi-success-border); background: var(--pi-success-bg); }
  .msg.event-group > summary { position: sticky; top: -26px; z-index: 5; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 9px 9px 0 0; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); color: var(--pi-muted); }
  .msg.event-group.live > summary { border-bottom-color: var(--pi-success-border); background: var(--pi-success-bg); color: var(--pi-success); }
  .msg.event-group > summary .label { margin: 0; }
  .group-body { padding: 0 12px 12px; }
  .chat-image { display: block; max-width: 100%; max-height: 320px; margin: 8px 0 0; border: 1px solid var(--pi-border-muted); border-radius: 8px; object-fit: contain; cursor: zoom-in; }
  .chat-image:focus-visible { outline: 2px solid var(--pi-accent, var(--pi-success-border)); outline-offset: 2px; }
  dialog.image-zoom { position: fixed; inset: 0; margin: auto; max-width: calc(96vw - env(safe-area-inset-left) - env(safe-area-inset-right)); max-height: calc(96vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)); width: fit-content; height: fit-content; padding: 0; border: none; background: transparent; overflow: visible; }
  dialog.image-zoom[open] { display: flex; }
  dialog.image-zoom::backdrop { background: rgba(0, 0, 0, 0.8); }
  .image-zoom-full { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: 8px; object-fit: contain; cursor: zoom-out; }
  .image-zoom-close { position: absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; font: 16px/1 system-ui, sans-serif; color: var(--pi-muted); background: color-mix(in srgb, var(--pi-surface) 88%, transparent); border: 1px solid var(--pi-border); border-radius: 6px; cursor: pointer; }
  .image-zoom-close:hover, .image-zoom-close:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
  .image-zoom-close:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  .group-msg { max-width: 100%; min-width: 0; box-sizing: border-box; padding: 10px 0; border-top: 1px solid var(--pi-border-muted); color: var(--pi-text); overflow: visible; }
  .group-msg.tool { color: var(--pi-warning); }
  .group-msg.tool-execution-shell { color: var(--pi-text); }
  .group-msg.system { color: var(--pi-danger); }
  .group-msg.bash { color: var(--pi-success); }
  .history-boundary { position: relative; z-index: 5; display: grid; gap: 3px; justify-items: center; margin: 0 0 14px; color: var(--pi-muted); font-size: 12px; text-align: center; }
  .history-load-button { border: 1px solid var(--pi-border); border-radius: 999px; background: var(--pi-surface); color: var(--pi-text-secondary); padding: 5px 12px; font: 12px system-ui, sans-serif; cursor: pointer; }
  .history-load-button:hover, .history-load-button:focus { border-color: var(--pi-accent); color: var(--pi-text-bright); }
  .history-load-button:disabled { cursor: default; opacity: .55; }
  .queued-messages { max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 8px; margin: 0 0 14px; padding: 12px; border: 1px solid var(--pi-warning-border); border-radius: 10px; background: var(--pi-warning-surface); color: var(--pi-text); overflow: hidden; }
  .queued-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .queued-heading { min-width: 0; flex: 1 1 180px; display: grid; gap: 2px; }
  .queued-heading strong { color: var(--pi-warning); }
  .queued-heading small { color: var(--pi-muted); }
  .queued-clear-button { flex: 0 0 auto; border: 1px solid var(--pi-warning-border); border-radius: 999px; background: var(--pi-surface); color: var(--pi-warning); padding: 5px 10px; font: 12px system-ui, sans-serif; white-space: nowrap; cursor: pointer; }
  .queued-clear-button:hover, .queued-clear-button:focus { border-color: var(--pi-warning); color: var(--pi-text-bright); }
  .queued-message { display: grid; gap: 4px; padding-top: 8px; border-top: 1px solid var(--pi-border); }
  .queued-message:first-of-type { padding-top: 0; border-top: 0; }
  .queued-kind { color: var(--pi-muted); font-size: 12px; text-transform: uppercase; }
  .queued-dialogs { margin: -8px 0 14px; padding: 0 4px; color: var(--pi-muted); font-size: 12px; text-align: center; }
  .session-activity { max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 4px; margin: 0 0 14px; padding: 12px; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); color: var(--pi-text); overflow: hidden; }
  .session-activity.compacting { border-color: var(--pi-purple-border); background: var(--pi-purple-surface); }
  .session-activity strong { color: var(--pi-purple); }
  .session-activity span, .session-activity small { color: var(--pi-muted); }
  .history-boundary small { color: var(--pi-dim); }
  .msg-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 22px; margin-bottom: 8px; }
  .msg > .msg-header { position: sticky; top: -26px; z-index: 4; margin: -12px -12px 8px; padding: 7px 10px 6px; border-radius: 9px 9px 0 0; border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent); background: var(--pi-surface); box-shadow: ${scrollHideShadow}; }
  .msg.user > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-accent-border) 35%, transparent); background: var(--pi-selection-bg); }
  .msg.assistant > .msg-header .label, .msg.tool-image-output > .msg-header .label { color: var(--pi-text-secondary); }
  .msg.user > .msg-header .label { color: var(--pi-accent); }
  .msg.tool > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-warning-border) 35%, transparent); background: var(--pi-warning-surface); }
  .msg.bash > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-success) 35%, transparent); background: var(--pi-success-bg); }
  .msg.skill > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-purple-border) 35%, transparent); background: var(--pi-purple-surface); }
  .group-msg > .msg-header { position: sticky; top: -26px; z-index: 4; margin: -10px 0 8px; padding: 7px 0 6px; border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent); background: var(--pi-bg); }
  .msg-header-trailing { min-width: 0; flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .msg-actions { flex: 0 0 auto; display: inline-flex; gap: 6px; opacity: 0; transition: opacity .12s ease; }
  .msg-action { display: inline-grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); padding: 0; font: 14px system-ui, sans-serif; line-height: 1; cursor: pointer; }
  .msg-action:hover, .msg-action:focus { color: var(--pi-text); border-color: var(--pi-accent); }
  .msg-action:disabled { opacity: .45; cursor: not-allowed; }
  .msg-fork-icon { font-size: 17px; }
  .msg:hover > .msg-header .msg-actions, .msg:focus-within > .msg-header .msg-actions, .group-msg:hover > .msg-header .msg-actions, .group-msg:focus-within > .msg-header .msg-actions { opacity: 1; }
  .label { display: block; color: var(--pi-muted); font-size: 12px; text-transform: uppercase; }
  .msg-header .label { margin: 0; }
  .msg-meta { min-width: 0; opacity: .28; border: 0; background: transparent; color: var(--pi-dim); padding: 0; font: 11px system-ui, sans-serif; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity .12s ease; cursor: pointer; user-select: text; -webkit-user-select: text; }
  .msg:hover > .msg-header .msg-meta, .msg:focus-within > .msg-header .msg-meta, .group-msg:hover > .msg-header .msg-meta, .group-msg:focus-within > .msg-header .msg-meta, .msg-meta:focus, .msg-meta.expanded { opacity: 1; }
  .msg-meta.expanded { flex: 1 1 auto; max-width: 100%; white-space: normal; overflow: visible; overflow-wrap: anywhere; text-overflow: clip; }
  .msg-meta:focus { outline: 1px solid var(--pi-border); outline-offset: 3px; border-radius: 4px; }
  @media (hover: none) {
    .msg-actions { opacity: 1; }
    .msg-meta { opacity: .75; max-width: 26px; }
    .msg-meta:not(.expanded) { display: inline-grid; width: 26px; height: 22px; place-items: center; font-size: 0; text-overflow: clip; }
    .msg-meta::before { content: "ⓘ"; font-size: 13px; }
    .msg-meta.expanded { opacity: 1; max-width: 100%; }
    .msg-meta.expanded::before { content: ""; }
  }
  formatted-text.part { display: block; width: 100%; }
  formatted-text.part, .queued-message formatted-text { text-align: start; unicode-bidi: plaintext; }
  .part { max-width: 100%; min-width: 0; box-sizing: border-box; overflow: visible; }
  .part + .part { margin-top: 10px; }
  .tool-line { color: var(--pi-warning); }
  .summary { color: var(--pi-muted); margin-left: 6px; }
  .part:is(details) { border-top: 1px solid var(--pi-border); padding-top: 8px; }
  .part > formatted-text { display: block; max-width: 100%; min-width: 0; overflow: visible; }
  .skill-invocation, .skill-read { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); padding: 8px 10px; }
  .skill-invocation > summary, .skill-read > strong { color: var(--pi-purple); }
  .skill-invocation > small, .skill-read > small { display: block; margin: 6px 0 0; color: var(--pi-muted); }
  summary { cursor: pointer; color: var(--pi-muted); }
  pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; direction: ltr; text-align: left; unicode-bidi: isolate; }
  .shell-output { color: var(--pi-text); font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; direction: ltr; text-align: left; unicode-bidi: isolate; }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
`;

export const formattedTextStyles = css`
  :host { display: block; }
  .formatted { white-space: normal; overflow-wrap: anywhere; line-height: 1.45; text-align: start; unicode-bidi: plaintext; }
  p, ul, ol, pre, blockquote, .table-scroll, .code-block-wrapper { margin: 0 0 10px; }
  :is(p, ul, ol, pre, blockquote, .table-scroll, .code-block-wrapper):last-child { margin-bottom: 0; }
  ul, ol { padding-left: 22px; }
  li + li { margin-top: 3px; }
  code { border: 1px solid var(--pi-border); border-radius: 4px; background: var(--pi-bg); padding: 1px 4px; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; direction: ltr; text-align: left; unicode-bidi: isolate; }
  .code-block-wrapper { position: relative; }
  .code-block-wrapper pre { margin: 0; padding-right: 40px; }
  pre { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); padding: 10px; overflow-x: auto; overflow-y: hidden; direction: ltr; text-align: left; unicode-bidi: isolate; }
  pre code { border: 0; padding: 0; background: transparent; }
  .code-copy-button { position: absolute; top: 6px; right: 6px; z-index: 1; display: inline-grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); padding: 0; font: 14px system-ui, sans-serif; line-height: 1; cursor: pointer; }
  .code-copy-button:hover, .code-copy-button:focus { color: var(--pi-text); border-color: var(--pi-accent); }
  blockquote { border-left: 3px solid var(--pi-border); padding-left: 10px; color: var(--pi-muted); }
  img { max-width: 100%; }
  a { color: var(--pi-accent); }
  h1, h2, h3, h4 { margin: 14px 0 8px; line-height: 1.2; }
  h1:first-child, h2:first-child, h3:first-child, h4:first-child { margin-top: 0; }
  h1 { font-size: 20px; }
  h2 { font-size: 17px; }
  h3 { font-size: 15px; }
  h4 { font-size: 14px; }
  .table-scroll { max-width: 100%; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
  .table-scroll:focus-visible { outline: 1px solid var(--pi-accent); outline-offset: 2px; }
  table { border-collapse: collapse; width: max-content; min-width: 100%; max-width: none; }
  th, td { border: 1px solid var(--pi-border); padding: 4px 8px; max-width: 48ch; overflow-wrap: anywhere; }
  th { background: var(--pi-surface); }
`;

export { appStyles, workspacePanelStyles, listStyles, statusBarStyles, autocompleteStyles, promptEditorStyles, scrollBoundaryShadow } from "../theme/base/shellStyles";

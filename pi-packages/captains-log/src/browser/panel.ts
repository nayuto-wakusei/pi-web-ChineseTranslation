import type { PluginActivationContext, WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";
import type { LogEntry } from "./protocol.js";
import { renderCaptainMarkdown } from "./markdown.js";

type Html = PluginActivationContext["html"];
export interface SourceSession { id: string; name: string }
export function selectedSourceSession(context: WorkspacePanelContext): SourceSession | undefined {
  if (context.state?.selectedMachine && context.state.selectedMachine.id !== context.machine.id) return;
  const selected = context.state?.selectedSession;
  if (!selected || selected.archived || selected.pending || selected.cwd !== context.workspace.path) return;
  return { id: selected.id, name: selected.name !== undefined && selected.name.trim() !== "" ? selected.name : `会话 ${selected.id.slice(0, 8)}` };
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
  return { running: "处理中", completed: "已完成", failed: "失败", interrupted: "已中断" }[status];
}

const stageLabels: Readonly<Record<string, string>> = {
  "Backend admitted translation": "后端已接收转述请求",
  "Backend sent request to native companion": "后端已向原生伴随扩展发送请求",
  "Native companion received request": "原生伴随扩展已收到请求",
  "Native Pi agent running": "原生 Pi 代理正在运行",
  "Backend received correlated final reply": "后端已收到匹配请求的最终回复",
  "Source reply read without changing source": "已读取源回复，未改动源会话",
  "Pirate conversation selected": "已选择船长会话",
  "Backend recorded failure (not success)": "后端已记录失败，不是成功结果",
  "Backend saved completed roundtrip": "后端已保存完成结果",
};
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
  const status = view.connecting ? "连接中…" : !view.connected ? "连接已断开" : view.pending ? "正在读取最后一条回复…"
    : working ? "船长正在转述…" : !view.source ? "请先选择当前工作区中的会话。" : pirateSelected ? "请选择其他会话，当前会话是船长会话。"
      : "可以开始转述";
  return html`<style>${styles}</style>
    <section class="captains-log" aria-label="船长日志">
      <div class="captain-heading"><h2>⚓ 船长日志</h2><p class="muted">让戏剧化的海盗船长转述最后一条回复。</p></div>
      <div class="captain-source"><span class="muted">选中会话</span><strong>${view.source?.name ?? "未选择会话"}</strong></div>
      <button class="captain-primary" ?disabled=${disabled} @click=${view.onTranslate}>让船长转述</button>
      <p class="captain-status" role="status" aria-live="polite">${status}
        ${!view.connected && !view.connecting ? html`<button @click=${view.onReconnect}>重新连接</button>` : null}
      </p>
      ${!view.connected && !view.connecting ? html`<p class="captain-notice">重新连接以查看结果。船长可能仍在处理，不会再次发送你的请求。</p>` : null}
      ${view.notice !== undefined && view.notice !== "" ? html`<p class="captain-notice" role="alert">${view.notice}</p>` : null}
      ${selected ? html`<article class="captain-reply" aria-label="船长转述">
        <div class="captain-reply-heading"><strong>${selected.status === "running" ? "转述中…" : selected.id === view.entries[0]?.id ? "最近转述" : "历史转述"}</strong><time datetime=${selected.createdAt}>${dateLabel(selected.createdAt)}</time></div>
        ${selected.status === "completed" ? html`<div class="captain-answer">${selected.text ? renderCaptainMarkdown(html, selected.text) : "正在接收船长回复…"}</div>`
          : selected.status === "running" ? html`<p class="muted">正在读取源回复并改写为海盗风格，不向源会话发送消息。</p>`
            : html`<div class="captain-notice" role="alert"><strong>${selected.status === "interrupted" ? "转述已中断" : "无法转述该回复"}</strong><p>${selected.text || "请查看诊断详情，待会话就绪后重试。"}</p></div>`}
        ${sourceSessionId !== undefined && sourceSessionId !== "" ? html`<button @click=${() => { view.onOpenSource(sourceSessionId); }}>打开源会话</button>` : null}
      </article>` : html`<p class="captain-empty muted">选择会话后转述其最新已完成的助手回复，原会话保持不变。</p>`}
      <div class="captain-secondary">
        ${view.entries.length > 1 ? html`<details><summary>历史转述 <span class="muted">(${view.entries.length})</span></summary>
          <div class="captain-history">${view.entries.map((entry) => html`<button class=${entry.id === selected?.id ? "selected" : ""} ?disabled=${!view.connected} @click=${() => { view.onRead(entry.id); }}>
            <span>${dateLabel(entry.createdAt)} · ${entry.status === "completed" ? "已转述" : entry.status === "running" ? "处理中" : "未完成"}</span>
          </button>`)}</div>
        </details>` : null}
        <details class="captain-diagnostics"><summary>诊断</summary>
          <p>${view.status}</p>
          ${selected ? html`<dl><dt>机器</dt><dd>${view.machineName}</dd><dt>源会话</dt><dd>${selected.sourceSessionId ?? "未知"}</dd><dt>船长会话</dt><dd>${selected.sessionId || "尚未创建"}</dd><dt>请求</dt><dd>${selected.id}</dd></dl>
            <p>${selected.question === "Translate last reply" ? "转述最后一条回复" : selected.question}</p><ol>${selected.stages.map((stage) => html`<li>${stageLabels[stage] ?? stage}</li>`)}</ol>` : null}
        </details>
        <p class="captain-footnote muted">使用你配置的模型，可能产生费用。可用时复用船长会话，否则自动创建。</p>
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

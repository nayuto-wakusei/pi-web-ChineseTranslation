import type { PiWebPlugin, WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";
import { isReview, type Review } from "./protocol.js";

interface PanelState { reviews: Review[]; selected?: Review; busy: boolean; status: string }
function reviewStatusLabel(status: Review["status"]): string {
  return { running: "处理中", completed: "已完成", failed: "失败", interrupted: "已中断" }[status];
}
const plugin: PiWebPlugin = {
  apiVersion: 4,
  name: "工作区审查",
  activate({ html }) {
    const states = new Map<string, PanelState>();
    let disposed = false;
    const stateFor = (context: WorkspacePanelContext) => {
      const key = JSON.stringify([context.machine.id, context.workspace.projectId, context.workspace.id]);
      let state = states.get(key);
      if (!state) { state = { reviews: [], busy: false, status: "刷新以加载已保存的审查，或开始新审查。" }; states.set(key, state); }
      return state;
    };
    async function perform(context: WorkspacePanelContext, operation: "start" | "list" | "read", id?: string): Promise<void> {
      const state = stateFor(context);
      if (state.busy) return;
      state.busy = true;
      state.status = operation === "start" ? "正在启动审查…" : "正在加载审查…";
      context.host.requestRender();
      try {
        if (!context.peer?.request) throw new Error("所选机器的插件后端不可用");
        const result: unknown = await context.peer.request(operation, id ?? null);
        if (operation === "list") {
          if (!Array.isArray(result) || !result.every(isReview)) throw new Error("审查列表无效");
          state.reviews = result;
          const selectedId = state.selected?.id ?? result[0]?.id;
          if (selectedId !== undefined && result.some((review) => review.id === selectedId)) {
            const selected: unknown = await context.peer.request("read", selectedId);
            if (!isReview(selected)) throw new Error("已保存的审查无效");
            state.selected = selected;
            state.reviews = state.reviews.map((review) => review.id === selected.id ? { ...selected, text: "" } : review);
          } else delete state.selected;
          state.status = `${String(result.length)} 条已保存的审查。`;
        } else {
          if (!isReview(result)) throw new Error("审查响应无效");
          state.selected = result;
          if (operation === "start") state.reviews = [result, ...state.reviews];
          else state.reviews = state.reviews.map((review) => review.id === result.id ? { ...result, text: "" } : review);
          state.status = operation === "start" ? "审查已受理。刷新查看进度，可在会话中打开对应对话。" : "审查已加载。";
        }
      } catch (error) { state.status = error instanceof Error ? error.message : String(error); }
      finally { state.busy = false; if (!disposed) context.host.requestRender(); }
    }
    return {
      contributions: {
        workspacePanels: [{
          id: "reviews", title: "审查",
          render(context) {
            const state = stateFor(context);
            const disabled = state.busy || !context.peer?.request;
            const index = state.reviews.findIndex((review) => review.id === state.selected?.id);
            const cycle = (delta: number) => {
              const next = state.reviews[(index + delta + state.reviews.length) % state.reviews.length];
              if (next) void perform(context, "read", next.id);
            };
            return html`<section class="viewer">
              <p>在新的 Pi 会话中审查此工作区的未提交改动，不请求修复，使用已配置的模型。</p>
              <button ?disabled=${disabled || state.reviews.some((review) => review.status === "running")} @click=${() => { void perform(context, "start"); }}>开始审查</button>
              <button ?disabled=${disabled} @click=${() => { void perform(context, "list"); }}>刷新审查</button>
              <p role="status" aria-live="polite">${state.status}</p>
              <label>已保存的审查 <select aria-label="已保存的审查" ?disabled=${disabled || !state.reviews.length}
                @change=${(event: Event) => {
                  if (event.target instanceof HTMLSelectElement && event.target.value !== "") void perform(context, "read", event.target.value);
                }}>
                <option value="" ?selected=${!state.selected}>选择审查</option>
                ${state.reviews.map((review) => html`<option value=${review.id} ?selected=${review.id === state.selected?.id}>${review.createdAt} — ${reviewStatusLabel(review.status)}</option>`)}
              </select></label>
              <button ?disabled=${disabled || state.reviews.length < 2} @click=${() => { cycle(-1); }}>上一条审查</button>
              <button ?disabled=${disabled || state.reviews.length < 2} @click=${() => { cycle(1); }}>下一条审查</button>
              ${state.selected ? html`<h3>${reviewStatusLabel(state.selected.status)}</h3>
                <p>会话：${state.selected.sessionId || "尚未创建，请稍后刷新"}</p>
                <pre style="white-space: pre-wrap; overflow-wrap: anywhere;">${state.selected.text}</pre>` : html`<p>未选择审查。</p>`}
            </section>`;
          },
        }],
      },
      dispose() { disposed = true; states.clear(); },
    };
  },
};
export default plugin;

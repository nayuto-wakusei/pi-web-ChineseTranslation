import type { PiWebPlugin, WorkspacePanelContext, PluginPeerChannel } from "@chainingintention/pi-web-cn/plugin-api";
import { isLogEntry, MAX_FINDINGS, type LogEntry } from "./protocol.js";
import { captainStatusLabel, renderCaptainPanel, selectedSourceSession } from "./panel.js";
import { LOG_CHANNEL, isCaptainServerFrame, type CaptainClientFrame } from "./channelProtocol.js";

interface PanelState {
  entries: LogEntry[]; selected?: LogEntry; status: string;
  notice?: string;
  connecting: boolean; channel?: PluginPeerChannel; controller?: AbortController;
  pending?: string; revision: number; readRevision: number; updates: Map<string, LogEntry>;
}
const plugin: PiWebPlugin = {
  apiVersion: 4,
  name: "船长日志",
  activate({ html, runtimePluginId, lifetimeSignal }) {
    if (!customElements.get("captains-log-lifetime")) {
      customElements.define("captains-log-lifetime", class extends HTMLElement {
        mount?: () => void;
        unmount?: () => void;
        private currentScope: unknown;
        set scope(value: unknown) {
          if (value === this.currentScope) return;
          this.currentScope = value;
          if (this.isConnected) queueMicrotask(() => { if (this.isConnected) this.mount?.(); });
        }
        connectedCallback() { queueMicrotask(() => { if (this.isConnected) this.mount?.(); }); }
        disconnectedCallback() { this.unmount?.(); }
      });
    }
    const states = new Map<string, PanelState>();
    let current: PanelState | undefined;
    function stop(state: PanelState) {
      state.revision++;
      state.controller?.abort();
      state.channel?.close();
      delete state.channel;
      delete state.controller;
      state.connecting = false;
      if (state.pending !== undefined) state.status = "通道已关闭，请求接收状态不确定；请重新连接后再重试，不会自动重发。";
    }
    const stopAll = () => { for (const state of states.values()) stop(state); };
    lifetimeSignal.addEventListener("abort", stopAll, { once: true });
    function stateFor(context: WorkspacePanelContext): PanelState {
      const key = JSON.stringify([context.machine.id, context.workspace.projectId, context.workspace.id]);
      let state = states.get(key);
      if (!state) {
        state = { entries: [], status: "正在连接船长日志…", connecting: false, revision: 0, readRevision: 0, updates: new Map() };
        states.set(key, state);
      }
      if (current !== state) { if (current) stop(current); current = state; }
      return state;
    }
    function upsert(state: PanelState, entry: LogEntry) {
      state.updates.set(entry.id, entry);
      state.entries = [entry, ...state.entries.filter((item) => item.id !== entry.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (!state.selected || state.selected.id === entry.id || entry.status === "running") {
        if (state.selected?.id !== entry.id) state.readRevision++;
        state.selected = entry;
      }
    }
    async function readEntry(context: WorkspacePanelContext, state: PanelState, id: string) {
      const revision = state.revision;
      const readRevision = ++state.readRevision;
      const before = state.updates.get(id);
      try {
        if (!context.peer?.request) throw new Error("船长日志保存记录不可用");
        const entry: unknown = await context.peer.request("read", id, { signal: state.controller?.signal ?? lifetimeSignal });
        if (revision !== state.revision || readRevision !== state.readRevision || lifetimeSignal.aborted) return;
        if (!isLogEntry(entry)) throw new Error("船长日志记录无效");
        const record = state.updates.get(id) !== before ? state.updates.get(id) ?? entry : entry;
        state.selected = record;
        state.updates.set(id, record);
        state.entries = state.entries.map((item) => item.id === id ? record : item);
        context.host.requestRender();
      } catch (error) {
        if (revision !== state.revision || readRevision !== state.readRevision || lifetimeSignal.aborted) return;
        state.status = String(error); context.host.requestRender();
      }
    }
    async function connect(context: WorkspacePanelContext, state: PanelState) {
      if (state.channel || state.connecting || lifetimeSignal.aborted) return;
      stop(state);
      const revision = state.revision;
      const controller = new AbortController();
      state.controller = controller;
      state.connecting = true;
      state.updates.clear();
      const live = () => revision === state.revision && !controller.signal.aborted && !lifetimeSignal.aborted;
      state.status = "正在连接船长日志…";
      context.host.requestRender();
      try {
        if (!context.peer?.openChannel || !context.peer.request) throw new Error("当前机器的船长日志后端通道不可用");
        const channel = await context.peer.openChannel(LOG_CHANNEL, null, {
          signal: controller.signal,
          onData(data) {
            if (!live()) return;
            if (!isCaptainServerFrame(data)) { state.status = "船长日志通道帧无效"; stop(state); context.host.requestRender(); return; }
            if (data.type === "admitted" && data.requestId === state.pending) {
              delete state.pending;
              state.status = `后端已接收 ${data.id}，接收不代表完成。`;
            } else if (data.type === "rejected" && data.requestId === state.pending) {
              delete state.pending; state.status = data.message; state.notice = data.message;
            } else if (data.type === "entry") {
              upsert(state, data.entry);
              state.status = data.saved && data.entry.status !== "running" ? `后端已保存结果，状态：${captainStatusLabel(data.entry.status)}。` : "船长日志正在接收进度。";
            } else if (data.type === "text") {
              const entry = state.updates.get(data.id);
              if (entry) {
                // Host channel payloads are deeply frozen; accumulate in a new owned record.
                const updated = { ...entry, text: (entry.text + data.text).slice(0, MAX_FINDINGS) };
                state.updates.set(data.id, updated);
                state.entries = state.entries.map((item) => item.id === data.id ? updated : item);
                if (state.selected?.id === data.id) state.selected = updated;
              }
            }
            context.host.requestRender();
          },
        });
        if (!live()) { channel.close(); return; }
        state.channel = channel;
        void channel.closed.then((closed) => {
          if (!live()) return;
          stop(state);
          state.status = `${closed.error?.message ?? "通道已关闭"}。请求接收状态可能不确定，请重新连接恢复已保存状态；不会自动重发。`;
          context.host.requestRender();
        });
        // Subscribe first, then merge the snapshot without overwriting newer pushed entries.
        const result: unknown = await context.peer.request("list", null, { signal: controller.signal });
        if (!live()) return;
        if (!Array.isArray(result) || !result.every(isLogEntry)) throw new Error("船长日志快照无效");
        state.entries = [...state.updates.values(), ...result.filter((entry) => entry.sourceSessionId !== undefined && !state.updates.has(entry.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        delete state.pending;
        const id = state.selected?.id ?? state.entries[0]?.id;
        if (id !== undefined && state.entries.some((entry) => entry.id === id)) {
          const pushed = state.updates.get(id);
          if (pushed) state.selected = pushed;
          else await readEntry(context, state, id);
        } else delete state.selected;
        if (!live()) return;
        state.status = "已连接，后端将实时推送更新。";
        delete state.notice;
        state.connecting = false;
        context.host.requestRender();
      } catch (error) {
        if (!live()) return;
        stop(state); state.status = `${String(error)}。请手动重新连接，没有重发转述请求。`;
        context.host.requestRender();
      }
    }
    function translate(context: WorkspacePanelContext, state: PanelState) {
      const source = selectedSourceSession(context);
      if (!source || !state.channel || state.connecting || state.pending !== undefined || lifetimeSignal.aborted || state.entries.some((entry) => entry.status === "running" || entry.sessionId === source.id)) return;
      state.pending = crypto.randomUUID();
      delete state.notice;
      state.status = `源会话 ${source.id} 的转述已排队，等待后端接收。`;
      const frame: CaptainClientFrame = { type: "translate", requestId: state.pending, sourceSessionId: source.id };
      try { state.channel.send(frame); }
      catch (error) { stop(state); state.status = `${String(error)}。请求接收状态不确定，请重新连接后再重试。`; }
      context.host.requestRender();
    }
    return {
      contributions: {
        actions: [{
          id: "summon", title: "打开船长转述", group: "船长日志",
          enabled: ({ state }) => Boolean(state.selectedWorkspace),
          run: ({ selectWorkspaceTool }) => { selectWorkspaceTool(`${runtimePluginId}:log`); },
        }],
        workspacePanels: [{
          id: "log", title: "船长日志",
          render(context) {
            const state = stateFor(context);
            const source = selectedSourceSession(context);
            return html`<captains-log-lifetime .mount=${() => { void connect(context, state); }} .unmount=${() => { stop(state); }} .scope=${state}>
              ${renderCaptainPanel(html, {
                ...state,
                connected: state.channel !== undefined && context.peer?.openChannel !== undefined,
                pending: state.pending !== undefined,
                machineName: context.machine.name,
                ...(source ? { source } : {}),
                onTranslate() { translate(context, state); },
                onReconnect() { void connect(context, state); },
                onRead(id) { void readEntry(context, state, id); },
                onOpenSource(sessionId) {
                  void context.navigate({ machineId: context.machine.id, projectId: context.workspace.projectId, workspaceId: context.workspace.id, sessionId, view: "chat" });
                },
              })}
            </captains-log-lifetime>`;
          },
        }],
      },
      dispose() {
        stopAll();
        lifetimeSignal.removeEventListener("abort", stopAll);
        states.clear();
      },
    };
  },
};
export default plugin;

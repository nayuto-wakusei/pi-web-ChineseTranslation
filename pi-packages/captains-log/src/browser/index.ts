import { t, setTranslator } from "../../i18n.js";
import type { PiWebPlugin, WorkspacePanelContext, PluginPeerChannel, PluginCapability, StylesheetIntegrationCapabilityV1 } from "@chainingintention/pi-web-cn/plugin-api";
import { isLogEntry, MAX_FINDINGS, type LogEntry } from "./protocol.js";
import { captainStatusLabel, renderCaptainPanel, selectedSourceSession } from "./panel.js";
import { LOG_CHANNEL, isCaptainServerFrame, type CaptainClientFrame } from "./channelProtocol.js";

const stylesheetIntegrationCapability: PluginCapability<StylesheetIntegrationCapabilityV1, 1> = {
  pluginId: "pi-web", id: "stylesheet-integration", version: 1,
  parse(value) {
    if (!isStylesheetIntegration(value)) {
      throw new Error("Invalid PI WEB stylesheet integration capability v1");
    }
    return value;
  },
};

function isStylesheetIntegration(value: unknown): value is StylesheetIntegrationCapabilityV1 {
  return typeof value === "object" && value !== null
    && "registerRoot" in value && typeof value.registerRoot === "function"
    && "subscribe" in value && typeof value.subscribe === "function"
    && "createController" in value && typeof value.createController === "function";
}

interface PanelState {
  entries: LogEntry[]; selected?: LogEntry; status: string;
  notice?: string;
  connecting: boolean; channel?: PluginPeerChannel; controller?: AbortController;
  pending?: string; revision: number; readRevision: number; updates: Map<string, LogEntry>;
}
const plugin: Extract<PiWebPlugin, { apiVersion: 4 }> = {
  apiVersion: 4,
  name: t("ui.main.40c450439267", "Captain's Log"),
  requires: [stylesheetIntegrationCapability],
  activate({ html, runtimePluginId, lifetimeSignal, translate: translator }) {
    setTranslator(translator);
    let stylesheetIntegration: StylesheetIntegrationCapabilityV1 | undefined;
    if (!customElements.get("captains-log-lifetime")) {
      customElements.define("captains-log-lifetime", class extends HTMLElement {
        mount?: () => void;
        unmount?: () => void;
        private currentScope: unknown;
        private integration: StylesheetIntegrationCapabilityV1 | undefined;
        private releaseStyles: (() => void) | undefined;
        set stylesheetIntegration(value: StylesheetIntegrationCapabilityV1 | undefined) {
          if (this.integration === value) return;
          this.releaseStyles?.();
          this.releaseStyles = undefined;
          this.integration = value;
          this.registerStyles();
        }
        private registerStyles() {
          if (!this.isConnected || this.releaseStyles !== undefined) return;
          const root = this.getRootNode();
          // Reuse the host panel root without creating another rendering boundary.
          if (root instanceof ShadowRoot) this.releaseStyles = this.integration?.registerRoot(root, { sharedUi: true });
        }
        set scope(value: unknown) {
          if (value === this.currentScope) return;
          this.currentScope = value;
          if (this.isConnected) queueMicrotask(() => { if (this.isConnected) this.mount?.(); });
        }
        connectedCallback() {
          this.registerStyles();
          queueMicrotask(() => { if (this.isConnected) this.mount?.(); });
        }
        disconnectedCallback() {
          this.releaseStyles?.();
          this.releaseStyles = undefined;
          this.unmount?.();
        }
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
      if (state.pending !== undefined) state.status = t("ui.main.f396b70620bc", "Channel closed. Admission is uncertain; reconnect before retrying. Questions are never resent automatically.");
    }
    const stopAll = () => { for (const state of states.values()) stop(state); };
    lifetimeSignal.addEventListener("abort", stopAll, { once: true });
    function stateFor(context: WorkspacePanelContext): PanelState {
      const key = JSON.stringify([context.machine.id, context.workspace.projectId, context.workspace.id]);
      let state = states.get(key);
      if (!state) {
        state = { entries: [], status: t("ui.main.b53dd9c80b8e", "Connecting to Captain's Log…"), connecting: false, revision: 0, readRevision: 0, updates: new Map() };
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
        if (!context.peer?.request) throw new Error(t("ui.main.1f43dcbac9b1", "Captain saved records unavailable"));
        const entry: unknown = await context.peer.request("read", id, { signal: state.controller?.signal ?? lifetimeSignal });
        if (revision !== state.revision || readRevision !== state.readRevision || lifetimeSignal.aborted) return;
        if (!isLogEntry(entry)) throw new Error(t("ui.main.66223db3b219", "Invalid Captain record"));
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
      state.status = t("ui.main.b53dd9c80b8e", "Connecting to Captain's Log…");
      context.host.requestRender();
      try {
        if (!context.peer?.openChannel || !context.peer.request) throw new Error(t("ui.main.8c0382b8ace3", "Captain backend channels unavailable on this machine"));
        const channel = await context.peer.openChannel(LOG_CHANNEL, null, {
          signal: controller.signal,
          onData(data) {
            if (!live()) return;
            if (!isCaptainServerFrame(data)) { state.status = t("ui.main.009b398507ef", "Invalid Captain channel frame"); stop(state); context.host.requestRender(); return; }
            if (data.type === "admitted" && data.requestId === state.pending) {
              delete state.pending;
              state.status = t("ui.main.39c27a5c621c", "The backend accepted {arg0}; acceptance is not completion.", { arg0: data.id });
            } else if (data.type === "rejected" && data.requestId === state.pending) {
              delete state.pending; state.status = data.message; state.notice = data.message;
            } else if (data.type === "entry") {
              upsert(state, data.entry);
              state.status = data.saved && data.entry.status !== "running" ? t("ui.main.ba9cee805bff", "The backend saved the result with status {arg0}.", { arg0: captainStatusLabel(data.entry.status) }) : t("ui.main.330b2b9daff1", "Captain's Log is receiving progress.");
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
          state.status = t("ui.main.59bb9b623aa3", "{arg0}. Request acceptance may be uncertain; reconnect to restore saved state. Requests are not resent automatically.", { arg0: closed.error?.message ?? t("ui.main.5de098bdc01f", "Channel closed") });
          context.host.requestRender();
        });
        // Subscribe first, then merge the snapshot without overwriting newer pushed entries.
        const result: unknown = await context.peer.request("list", null, { signal: controller.signal });
        if (!live()) return;
        if (!Array.isArray(result) || !result.every(isLogEntry)) throw new Error(t("ui.main.e18b3550af5f", "Invalid Captain snapshot"));
        state.entries = [...state.updates.values(), ...result.filter((entry) => entry.sourceSessionId !== undefined && !state.updates.has(entry.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        delete state.pending;
        const id = state.selected?.id ?? state.entries[0]?.id;
        if (id !== undefined && state.entries.some((entry) => entry.id === id)) {
          const pushed = state.updates.get(id);
          if (pushed) state.selected = pushed;
          else await readEntry(context, state, id);
        } else delete state.selected;
        if (!live()) return;
        state.status = t("ui.main.a1fa58242a2e", "Connected. Live updates arrive from the backend.");
        delete state.notice;
        state.connecting = false;
        context.host.requestRender();
      } catch (error) {
        if (!live()) return;
        stop(state); state.status = t("ui.main.b74852b31c3b", "{arg0}. Reconnect manually; the relay request has not been resent.", { arg0: String(error) });
        context.host.requestRender();
      }
    }
    function translate(context: WorkspacePanelContext, state: PanelState) {
      const source = selectedSourceSession(context);
      if (!source || !state.channel || state.connecting || state.pending !== undefined || lifetimeSignal.aborted || state.entries.some((entry) => entry.status === "running" || entry.sessionId === source.id)) return;
      state.pending = crypto.randomUUID();
      delete state.notice;
      state.status = t("ui.main.f0eb1567fb8f", "Relay for source session {arg0} is queued, awaiting backend acceptance.", { arg0: source.id });
      const frame: CaptainClientFrame = { type: "translate", requestId: state.pending, sourceSessionId: source.id };
      try { state.channel.send(frame); }
      catch (error) { stop(state); state.status = t("ui.main.737a9ae0b915", "{arg0}. Request acceptance is uncertain; reconnect before retrying.", { arg0: String(error) }); }
      context.host.requestRender();
    }
    return {
      start({ capabilities }) {
        stylesheetIntegration = capabilities.resolve(stylesheetIntegrationCapability);
      },
      contributions: {
        actions: [{
          id: "summon", title: t("ui.main.77d215cd18a6", "Open pirate translator"), group: t("ui.main.40c450439267", "Captain's Log"),
          enabled: ({ state }) => Boolean(state.selectedWorkspace),
          run: ({ selectWorkspaceTool }) => { selectWorkspaceTool(`${runtimePluginId}:log`); },
        }],
        workspacePanels: [{
          id: "log", title: t("ui.main.40c450439267", "Captain's Log"),
          render(context) {
            const state = stateFor(context);
            const source = selectedSourceSession(context);
            return html`<captains-log-lifetime .stylesheetIntegration=${stylesheetIntegration} .mount=${() => { void connect(context, state); }} .unmount=${() => { stop(state); }} .scope=${state}>
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

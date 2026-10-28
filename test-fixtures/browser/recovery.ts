import { api, type SessionInfo } from "../../src/client/src/api";
import { initialAppState } from "../../src/client/src/appState";
import { ConversationSyncNotice } from "../../src/client/src/components/ConversationSyncNotice";
import { SessionController } from "../../src/client/src/controllers/sessionController";

// Real transport/controller, isolated HTTP and WebSocket peers supplied by the
// browser tests. No session daemon, model calls, or user state are involved.
const session: SessionInfo = {
  id: "recovery", path: "/fixture/recovery.jsonl", cwd: "/fixture", name: "Recovery fixture",
  created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z", messageCount: 0, firstMessage: "",
};
let state = initialAppState();
const notice = new ConversationSyncNotice();
const transcript = document.createElement("main");
transcript.setAttribute("aria-label", "Conversation");
const draft = document.createElement("textarea");
draft.setAttribute("aria-label", "Draft");
const controller = new SessionController(() => state, (patch) => {
  state = { ...state, ...patch };
  notice.state = state.conversationSync;
  transcript.textContent = JSON.stringify(state.messages);
  document.body.dataset["sync"] = state.conversationSync;
}, () => undefined, undefined, { api: { ...api, thinkingLevels: () => Promise.resolve({ levels: [] }) } });
notice.onRetry = () => { void controller.resumeSelectedSession({ reconnect: true }); };
const styles = document.createElement("style");
styles.textContent = ":root { --pi-bg:#161616; --pi-surface:#252525; --pi-text:#eee; --pi-border:#555; --pi-muted:#aaa; --pi-error:#faa; } body { margin:16px; background:#161616; color:#eee; font:16px system-ui; } main { min-height:100px; overflow-wrap:anywhere; } textarea { width:100%; box-sizing:border-box; }";
document.head.append(styles);
document.body.append(notice, transcript, draft);
// Exercise the same controller read that the app's single periodic loop calls.
window.addEventListener("fixture-refresh", () => { void controller.refreshSelectedSession(undefined, { silent: true }); });
window.addEventListener("pagehide", () => { controller.dispose(); }, { once: true });
await controller.selectSession(session);

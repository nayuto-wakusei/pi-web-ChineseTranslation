import { api } from "../../src/client/src/api";
import { ChatView } from "../../src/client/src/components/ChatView";
import { PromptEditor } from "../../src/client/src/components/PromptEditor";
import { ConversationLayout } from "../../src/client/src/components/ConversationLayout";
import { setClientTranslations } from "../../src/client/src/i18n";

setClientTranslations("en", {});
api.commands = () => Promise.resolve([{ name: "tree", source: "builtin" }]);
api.files = () => Promise.resolve([]);
api.models = () => Promise.resolve({ models: [] });

const style = document.createElement("style");
style.textContent = `
  :root { color-scheme: dark; --pi-bg: #171a1b; --pi-surface: #242829; --pi-surface-hover: #303536; --pi-bg-overlay: #202526; --pi-text: #eceeed; --pi-text-bright: #fff; --pi-text-secondary: #bdc7c4; --pi-muted: #97a5a1; --pi-dim: #7c8985; --pi-border: #46514d; --pi-border-muted: #343f3b; --pi-accent: #75cab0; --pi-success: #83cf9e; --pi-success-surface: #274d3a; --pi-warning: #f2cd72; --pi-danger: #ed9696; --pi-font: system-ui, sans-serif; --pi-mono: ui-monospace, monospace; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; background: var(--pi-bg); color: var(--pi-text); font: 14px var(--pi-font); }
  header { display: flex; align-items: center; padding: 0 16px; min-height: 40px; border-bottom: 1px solid var(--pi-border); }
  conversation-layout { width: min(900px, 100%); margin-inline: auto; flex: 1 1 0; }
  .composer-area { min-width: 0; }
  .status { padding: 6px 16px; color: var(--pi-muted); border-top: 1px solid var(--pi-border); }
`;
document.head.append(style);
const header = document.createElement("header");
header.textContent = "Conversation and composer acceptance";
const layout = new ConversationLayout();
layout.sending = true;
const chat = new ChatView();
chat.sessionId = "composer-browser";
chat.sessionCwd = "/fixture";
chat.messages = Array.from({ length: 100 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant", entryId: `entry-${String(index)}`,
  parts: [{ type: "text", text: `Message ${String(index)}\n\n` + "Conversation text stays in its own scroll region. A long record should remain readable while the composer and its controls stay available. ".repeat(3) }],
}));
chat.messageTotal = 100;
chat.messageEnd = 100;
const editor = new PromptEditor();
editor.sessionId = chat.sessionId;
editor.cwd = chat.sessionCwd;
editor.shortcuts = { "composer.send.desktop": "enter", "composer.send.mobile": "enter" };
const sends: { text: string; behavior?: "steer" | "followUp" }[] = [];
editor.onSend = (text, behavior) => { sends.push({ text, ...(behavior === undefined ? {} : { behavior }) }); };
chat.onNavigationChange = (controls) => { editor.chatNavigation = controls; };
const composer = document.createElement("div");
composer.className = "composer-area";
composer.slot = "composer";
composer.append(editor);
const status = document.createElement("div");
status.className = "status";
status.slot = "status";
status.textContent = "Local fixture | No daemon or model requests";
layout.append(chat, composer, status);
document.body.append(header, layout);

async function settle(): Promise<void> {
  await chat.updateComplete;
  await editor.updateComplete;
  await layout.updateComplete;
  for (let index = 0; index < 5; index += 1) await new Promise<void>((resolve) => { requestAnimationFrame(() => { setTimeout(resolve, 0); }); });
}

declare global {
  interface Window {
    composerFixture: {
      settle: () => Promise<void>;
      replace: (text: string) => Promise<void>;
      sendCount: () => number;
      draft: () => string;
      compose: () => Promise<void>;
    };
  }
}
window.composerFixture = {
  settle,
  replace: async (text) => { editor.replaceText(text); await settle(); },
  sendCount: () => sends.length,
  draft: () => editor.view?.state.doc.toString() ?? "",
  compose: async () => {
    editor.replaceText("中文输入");
    const input = editor.view?.contentDOM;
    if (input === undefined) throw new Error("Expected CodeMirror input");
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true, composed: true }));
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文输入" }));
    await settle();
  },
};
await settle();
document.body.dataset["ready"] = "true";

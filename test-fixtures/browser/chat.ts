import { ChatView } from "../../src/client/src/components/ChatView";
import type { ChatLine } from "../../src/client/src/chatTypes";
import type { FormattedText } from "../../src/client/src/components/FormattedText";
import { setClientTranslations } from "../../src/client/src/i18n";

setClientTranslations("en", {});

const style = document.createElement("style");
style.textContent = `
  :root { color-scheme: dark; --pi-bg: #171a1b; --pi-surface: #242829; --pi-surface-hover: #303536; --pi-bg-overlay: #202526; --pi-text: #eceeed; --pi-text-bright: #fff; --pi-text-secondary: #bdc7c4; --pi-muted: #97a5a1; --pi-dim: #7c8985; --pi-border: #46514d; --pi-border-muted: #343f3b; --pi-accent: #75cab0; --pi-success: #83cf9e; --pi-warning: #f2cd72; --pi-warning-surface: #353021; --pi-warning-border: #72633b; --pi-danger: #ed9696; --pi-purple: #c9b4e5; --pi-font: system-ui, sans-serif; --pi-mono: ui-monospace, monospace; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { display: grid; grid-template-rows: 44px minmax(0, 1fr) 36px; background: var(--pi-bg); color: var(--pi-text); font: 14px var(--pi-font); }
  header, footer { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--pi-border); }
  footer { border-top: 1px solid var(--pi-border); border-bottom: 0; color: var(--pi-muted); font-size: 12px; }
  .stage { display: flex; flex-direction: column; width: min(900px, 100%); min-width: 0; min-height: 0; margin-inline: auto; }
  .stage[hidden] { display: none !important; }
  chat-view { flex: 1 1 0; min-width: 0; min-height: 0; }
`;
document.head.append(style);
const header = document.createElement("header");
header.textContent = "Chat rendering acceptance";
const stage = document.createElement("main");
stage.className = "stage";
const footer = document.createElement("footer");
footer.textContent = "Local fixture | No daemon or model requests";
document.body.append(header, stage, footer);

function bitmap(height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Canvas unavailable");
  context.fillStyle = "#286f66";
  context.fillRect(0, 0, 640, height);
  context.fillStyle = "#b5d4b5";
  context.fillRect(28, 28, 584, height - 56);
  context.fillStyle = "#17312e";
  context.font = "28px sans-serif";
  context.fillText(`Inline image 640 x ${String(height)}`, 48, 76);
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

const images = { short: bitmap(240), tall: bitmap(720) };
let tallImage = false;
let firstIndex = 40;
let streamCount = 0;
const view = new ChatView();
view.sessionId = "browser-chat";
view.machineId = "local";
view.sessionCwd = "/fixture";
view.isSendingPrompt = true;
view.activity = { sessionId: view.sessionId, phase: "active", label: "Streaming fixture response", at: "2026-10-22T00:00:00Z" };

function line(index: number): ChatLine {
  if (index === 108) return {
    role: "assistant", entryId: `entry-${String(index)}`, transcriptIndex: index,
    parts: [{ type: "thinking", text: "A disclosed analysis section.\n\n" + "Stable activity content for native details.\n\n".repeat(10) }],
  };
  if (index === 110) return {
    role: "user", entryId: `entry-${String(index)}`, transcriptIndex: index,
    parts: [{ type: "image", mimeType: "image/png", data: tallImage ? images.tall : images.short, width: 640, height: tallImage ? 720 : 240 }],
  };
  const text = `Message ${String(index)}: durable transcript content.\n\n` +
    "A readable paragraph with a workspace-independent local fixture and enough text to wrap naturally on a narrow viewport. ".repeat(3);
  return {
    role: index % 2 === 0 ? "user" : "assistant", transcriptIndex: index,
    ...(index === 159 ? { streamId: "fixture-stream" } : { entryId: `entry-${String(index)}` }),
    parts: [{ type: "text", text: text + (index === 159 ? "\n\n" + "Additional streamed detail.\n\n".repeat(streamCount) : "") }],
  };
}

view.messages = Array.from({ length: 160 - firstIndex }, (_, index) => line(firstIndex + index));
view.messageStart = firstIndex;
view.messageEnd = 160;
view.messageTotal = 160;
view.hasMore = true;
stage.append(view);

async function settle(): Promise<void> {
  await view.updateComplete;
  const formatted = [...view.renderRoot.querySelectorAll<FormattedText>("formatted-text")];
  await Promise.all(formatted.map((element) => element.updateComplete));
  for (let index = 0; index < 6; index++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { setTimeout(resolve, 0); }); });
  }
}

async function prepend(): Promise<void> {
  if (firstIndex === 0) return;
  view.loadingMore = true;
  await view.updateComplete;
  const previous = firstIndex;
  firstIndex = Math.max(0, firstIndex - 40);
  view.messages = [...Array.from({ length: previous - firstIndex }, (_, index) => line(firstIndex + index)), ...view.messages];
  view.messageStart = firstIndex;
  view.loadingMore = false;
  view.hasMore = firstIndex > 0;
  await settle();
}
view.onLoadMore = () => { void prepend(); };

declare global {
  interface Window {
    chatFixture: {
      settle: () => Promise<void>;
      append: () => Promise<void>;
      prepend: () => Promise<void>;
      loading: (loading: boolean) => Promise<void>;
      resizeImage: () => Promise<void>;
      hidden: (hidden: boolean) => Promise<void>;
    };
  }
}
window.chatFixture = {
  settle,
  append: async () => {
    streamCount += 8;
    view.messages = [...view.messages.slice(0, -1), line(159)];
    await settle();
  },
  prepend,
  loading: async (loading) => { view.loadingMore = loading; await settle(); },
  resizeImage: async () => {
    tallImage = !tallImage;
    view.messages = view.messages.map((message) => message.entryId === "entry-110" ? line(110) : message);
    await settle();
  },
  hidden: async (hidden) => { stage.hidden = hidden; await settle(); },
};
await settle();
document.body.dataset["ready"] = "true";

import { ChatView } from "../../src/client/src/components/ChatView";
import { SessionList } from "../../src/client/src/components/SessionList";
import { SessionSearchDialog } from "../../src/client/src/components/SessionSearchDialog";
import type { ChatLine } from "../../src/client/src/chatTypes";
import type { SessionInfo } from "../../src/client/src/api";
import { setClientTranslations } from "../../src/client/src/i18n";
import type { UiPresentationRegion } from "../../src/plugin-api";

setClientTranslations("en", {});
const main = document.querySelector("main");
if (main === null) throw new Error("Missing performance stage");
const style = document.createElement("style");
style.textContent = `
  html, body { height: 100%; margin: 0; }
  body { color: #242424; background: #fff; font: 14px system-ui, sans-serif; }
  main { display: flex; height: 100%; }
  chat-view { display: flex; flex: 1; min-height: 0; }
  session-list { display: flex; width: 320px; min-height: 0; }
  pi-web-ui-presentation { display: flex; min-height: 0; height: 100%; flex: 1; }
`;
document.head.append(style);
let wrapPresentation: ((content: HTMLElement, region: UiPresentationRegion, slot: string) => HTMLElement) | undefined;
if (new URLSearchParams(location.search).has("custom-ui")) {
  const [{ default: plugin }, { html, svg }, { UiPresentationRuntime, UiPresentationSurface }, { pluginStyles }] = await Promise.all([
    import("../../pi-web-plugins/custom-ui-codex/pi-web-plugin"),
    import("lit"),
    import("../../src/client/src/plugins/uiPresentation"),
    import("../../src/client/src/plugins/styles"),
  ]);
  const signal = new AbortController().signal;
  const activation = plugin.activate({ apiVersion: 5, pluginId: "custom-ui-codex", runtimePluginId: "custom-ui-codex", html, svg, signal, lifetimeSignal: signal });
  const runtime = new UiPresentationRuntime();
  runtime.register(activation.contributions.uiPresentations.map((entry) => ({ ...entry, pluginId: "custom-ui-codex", active: () => true })));
  pluginStyles.registerRoot(document);
  await pluginStyles.setContributions([
    ...activation.contributions.stylesheets,
    { id: "custom-ui-codex:paper:palette", url: new URL("../../pi-web-plugins/custom-ui-codex/paper.css?no-inline", import.meta.url).href },
  ]);
  wrapPresentation = (content, region, slot) => {
    const surface = new UiPresentationSurface();
    surface.region = region;
    surface.runtime = runtime;
    content.slot = slot;
    surface.append(content);
    return surface;
  };
}

interface ScenarioResult {
  mountMs: number;
  durations: number[];
  timerDelays: number[];
  longTasks: number[];
  mountedNodes: number;
  retainedMessages: number;
  renderedRows: number;
}
declare global {
  interface Window {
    runUiPerformanceScenario: (scenario: "chat" | "switch" | "navigation" | "scroll" | "search") => Promise<ScenarioResult>;
  }
}

function messages(count: number, session = "chat"): ChatLine[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    entryId: `${session}-${String(index)}`,
    meta: { timestamp: new Date(Date.UTC(2026, 10, 3, 8, 0, index)).toISOString() },
    parts: [{ type: "text", text: `Message ${String(index)}\n\n` + "A **stable** transcript paragraph and `code` with enough text to wrap. ".repeat(6) }],
  }));
}

function sessions(count: number): SessionInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${String(index)}`, cwd: "/fixture", path: `/fixture/session-${String(index)}.jsonl`,
    created: "2026-10-26T00:00:00Z", modified: "2026-10-26T00:00:00Z", messageCount: 10,
    firstMessage: `Session ${String(index)}`,
  }));
}

function countNodes(root: ParentNode): number {
  let count = 0;
  for (const element of root.querySelectorAll("*")) {
    count++;
    if (element.shadowRoot !== null) count += countNodes(element.shadowRoot);
  }
  return count;
}

const frame = () => new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
const longTasks: number[] = [];
if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
  new PerformanceObserver((list) => { longTasks.push(...list.getEntries().map((entry) => entry.duration)); }).observe({ type: "longtask" });
}

window.runUiPerformanceScenario = async (scenario) => {
  main.replaceChildren();
  const mountStarted = performance.now();
  const durations: number[] = [];
  const timerDelays: number[] = [];
  const longTaskStart = longTasks.length;
  const inputProbe = () => {
    const start = performance.now();
    return new Promise<void>((resolve) => { setTimeout(() => { timerDelays.push(performance.now() - start); resolve(); }, 0); });
  };
  if (scenario === "search") {
    const dialog = new SessionSearchDialog();
    dialog.query = "answer";
    main.append(dialog);
    await dialog.updateComplete;
    const mountMs = performance.now() - mountStarted;
    for (let index = 0; index < 40; index++) {
      const start = performance.now();
      const input = inputProbe();
      dialog.response = { matchCount: 200, truncated: true, results: sessions(20).map((session) => ({
        session, matches: Array.from({ length: 10 }, (_, messageIndex) => ({ messageIndex, role: "assistant" as const, occurrenceCount: 1,
          excerpts: [{ text: `An answer ${String(index)} with readable context. `.repeat(8), matchRanges: [{ start: 3, length: 6 }] }],
        })),
      })) };
      await dialog.updateComplete;
      durations.push(performance.now() - start);
      await input;
      await frame();
    }
    return { mountMs, durations, timerDelays, longTasks: longTasks.slice(longTaskStart), mountedNodes: countNodes(main), retainedMessages: dialog.response?.matchCount ?? 0, renderedRows: dialog.shadowRoot?.querySelectorAll(".match-row").length ?? 0 };
  }
  if (scenario === "navigation") {
    const list = new SessionList();
    list.externalScroll = wrapPresentation !== undefined;
    list.scopeKey = "local:fixture";
    list.sessions = sessions(5000);
    main.append(wrapPresentation?.(list, "navigation", "sessions") ?? list);
    await list.updateComplete;
    await frame();
    const mountMs = performance.now() - mountStarted;
    for (let index = 0; index < 40; index++) {
      const start = performance.now();
      const input = inputProbe();
      list.sending = { [`session-${String(index)}`]: true };
      await list.updateComplete;
      durations.push(performance.now() - start);
      await input;
      await frame();
    }
    return { mountMs, durations, timerDelays, longTasks: longTasks.slice(longTaskStart), mountedNodes: countNodes(main), retainedMessages: list.sessions.length, renderedRows: list.shadowRoot?.querySelectorAll(".action-row").length ?? 0 };
  }
  const view = new ChatView();
  view.machineId = "local";
  view.sessionId = "performance-chat";
  view.messages = messages(600);
  view.messageEnd = view.messages.length;
  view.messageTotal = view.messages.length;
  view.historyReady = true;
  main.append(wrapPresentation?.(view, "chat-chrome", "transcript") ?? view);
  await view.updateComplete;
  await frame();
  const mountMs = performance.now() - mountStarted;
  if (scenario === "scroll") {
    const scroller = view.shadowRoot?.querySelector<HTMLElement>(".chat");
    if (scroller === null || scroller === undefined) throw new Error("Missing chat scroller");
    if (scroller.scrollHeight <= scroller.clientHeight) throw new Error("Transcript is not scrollable");
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    for (let index = 0; index < 40; index++) {
      const start = performance.now();
      scroller.scrollTop = (index % 20) / 19 * (scroller.scrollHeight - scroller.clientHeight);
      await frame();
      durations.push(performance.now() - start);
    }
    return { mountMs, durations, timerDelays, longTasks: longTasks.slice(longTaskStart), mountedNodes: countNodes(main), retainedMessages: view.messages.length, renderedRows: view.shadowRoot?.querySelectorAll(".chat > article").length ?? 0 };
  }
  const prefix = view.messages.slice(0, -1);
  for (let index = 0; index < 40; index++) {
    const start = performance.now();
    const input = inputProbe();
    if (scenario === "switch") {
      view.sessionId = `performance-${String(index % 2)}`;
      view.messages = messages(120, view.sessionId);
    } else {
      view.messages = [...prefix, { role: "assistant", streamId: "stream", parts: [{ type: "text", text: "Streamed answer. ".repeat(index + 1) }] }];
    }
    await view.updateComplete;
    durations.push(performance.now() - start);
    await input;
    await frame();
  }
  return { mountMs, durations, timerDelays, longTasks: longTasks.slice(longTaskStart), mountedNodes: countNodes(main), retainedMessages: view.messages.length, renderedRows: view.shadowRoot?.querySelectorAll(".chat > article").length ?? 0 };
};
document.body.dataset["ready"] = "true";

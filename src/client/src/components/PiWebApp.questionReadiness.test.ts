// @vitest-environment happy-dom
import { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { SessionInfo } from "../api";
import { AskUserCard } from "./AskUserCard";
import { ChatView } from "./ChatView";
import { PiWebApp } from "./PiWebApp";
import { themeStylesheetFetch } from "./themeStylesheetFetch.testSupport";

class ReadinessApp extends PiWebApp {
  override connectedCallback(): void {
    LitElement.prototype.connectedCallback.call(this);
  }
}
customElements.define("question-readiness-test-app", ReadinessApp);

const session: SessionInfo = { id: "session", path: "/repo/session.jsonl", cwd: "/repo", created: "now", modified: "now", messageCount: 1, firstMessage: "hello" };
const unexpectedRequest = vi.fn(() => Promise.reject(new Error("Unexpected network request")));

beforeEach(() => {
  unexpectedRequest.mockClear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", themeStylesheetFetch(unexpectedRequest));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(unexpectedRequest).not.toHaveBeenCalled();
});

describe("conversation-owned question readiness", () => {
  it("opens a durable tail question only after authoritative history is ready and rerenders on readiness alone", async () => {
    const app = await mount();
    expect(chat(app).historyReady).toBe(false);
    expect(card(app).shadowRoot?.querySelector("form")).toBeNull();

    await ready(app, session);

    expect(chat(app).historyReady).toBe(true);
    expect(card(app).shadowRoot?.querySelector("form")).not.toBeNull();
    expect(card(app).shadowRoot?.textContent).toContain("发送回答");
  });

  it("does not reuse readiness for the same session ID on another machine", async () => {
    const app = await mount();
    await ready(app, session);
    const current: unknown = Reflect.get(app, "state");
    if (typeof current !== "object" || current === null) throw new Error("Missing app state");
    Reflect.set(app, "state", { ...current, selectedMachine: { id: "remote", name: "Remote", kind: "remote", baseUrl: "https://remote.test", createdAt: "now", updatedAt: "now" } });
    await settle(app);

    expect(chat(app).historyReady).toBe(false);
    expect(card(app).shadowRoot?.querySelector("form")).toBeNull();
  });

  it("keeps an archived question read-only even after history is ready", async () => {
    const archived = { ...session, archived: true };
    const app = await mount(archived);
    await ready(app, archived);

    expect(chat(app).historyReady).toBe(true);
    expect(chat(app).onSubmitAsk).toBeUndefined();
    expect(card(app).shadowRoot?.querySelector("form")).toBeNull();
  });
});

async function mount(selectedSession = session): Promise<ReadinessApp> {
  const app = new ReadinessApp();
  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  Reflect.set(app, "unreadConnected", true);
  const state: AppState = {
    ...initialAppState(), selectedSession, messagePageStart: 0, messagePageEnd: 1, messagePageTotal: 1,
    messages: [{ role: "tool", entryId: "question-entry", transcriptIndex: 0, parts: [{ type: "askUserQuestion", ask: { askId: "ask-1", askedAt: "now", questions: [{ id: "q1", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] }] } }] }],
  };
  Reflect.set(app, "state", state);
  document.body.append(app);
  await settle(app);
  return app;
}

async function ready(app: PiWebApp, selectedSession: SessionInfo): Promise<void> {
  const method: unknown = Reflect.get(app, "commitReadyChatAfterRender");
  if (typeof method !== "function") throw new Error("Missing readiness callback");
  await Reflect.apply(method, app, ["local", selectedSession]);
  await settle(app);
}

function chat(app: PiWebApp): ChatView {
  const view = app.shadowRoot?.querySelector("chat-view");
  if (!(view instanceof ChatView)) throw new Error("Missing chat view");
  return view;
}

function card(app: PiWebApp): AskUserCard {
  const view = chat(app).shadowRoot?.querySelector("ask-user-card");
  if (!(view instanceof AskUserCard)) throw new Error("Missing question card");
  return view;
}

async function settle(element: LitElement): Promise<void> {
  await element.updateComplete;
  for (const child of element.shadowRoot?.querySelectorAll("*") ?? []) {
    if (child instanceof LitElement) await settle(child);
  }
  await element.updateComplete;
}

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClientTranslations } from "../i18n";
import { machineSessionKey } from "../machineKeys";
import { chatScrollStorageKey } from "../chatScrollPosition";
import type { ChatLine } from "../chatTypes";
import { ChatView } from "./ChatView";
import { controlledChatViewport, manualChatFrames } from "./chatScroll.testSupport";

beforeEach(() => { setClientTranslations("en", {}); });
afterEach(() => {
  document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function settle(view: ChatView): Promise<void> {
  await view.updateComplete;
  await view.updateComplete;
}

function message(text: string): ChatLine {
  return { role: "assistant", entryId: "entry", streamId: "stream", transcriptIndex: 45, parts: [{ type: "text", text }] };
}

describe("chat merge ownership boundaries", () => {
  it("reports the actual message window rather than deriving raw pagination from rendered line count", async () => {
    const view = new ChatView();
    view.sessionId = "same";
    view.messages = [message("reply"), { role: "tool", parts: [{ type: "toolResultBoundary" }] }];
    view.messageStart = 40;
    view.messageEnd = 60;
    view.messageTotal = 70;
    const rendered = vi.fn();
    view.onTranscriptRendered = rendered;
    document.body.append(view);
    await settle(view);
    expect(rendered).toHaveBeenLastCalledWith({ sessionId: "same", messages: view.messages, start: 40, end: 60 });
    expect(view.messages[0]?.transcriptIndex).toBe(45);
    expect(view.renderRoot.querySelector("article")?.getAttribute("data-scroll-anchor-id")).toContain("entry");
    expect(view.renderRoot.querySelectorAll("article")).toHaveLength(1);
    view.machineId = "other";
    view.messageStart = 0;
    view.messageEnd = 3;
    view.messages = [message("different machine")];
    await settle(view);
    expect(rendered).toHaveBeenLastCalledWith({ sessionId: "same", messages: view.messages, start: 0, end: 3 });
  });

  it("does not share stored reading positions between machines with reused session ids", async () => {
    manualChatFrames();
    const view = new ChatView();
    view.machineId = "first";
    view.sessionId = "same";
    view.messages = [message("reply")];
    document.body.append(view);
    await settle(view);
    controlledChatViewport(view);
    const article = view.renderRoot.querySelector("article");
    if (article === null) throw new Error("Missing durable anchor");
    vi.spyOn(article, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 120, 600, 80));
    view.saveScrollPosition();
    const firstKey = chatScrollStorageKey(machineSessionKey("first", "same"));
    const saved = localStorage.getItem(firstKey);
    expect(saved).not.toBeNull();
    view.machineId = "second";
    await settle(view);
    const replacement = view.renderRoot.querySelector("article");
    if (replacement === null) throw new Error("Missing new machine anchor");
    vi.spyOn(replacement, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 140, 600, 80));
    view.saveScrollPosition();
    expect(localStorage.getItem(chatScrollStorageKey(machineSessionKey("second", "same")))).not.toBeNull();
    expect(localStorage.getItem(firstKey)).toBe(saved);
    expect(localStorage.getItem(chatScrollStorageKey("same"))).toBeNull();
  });

  it("retires in-flight action errors when the workspace context changes without changing session id", async () => {
    const view = new ChatView();
    view.sessionId = "same";
    view.messages = [message("reply")];
    view.workspaceContext = { machineId: "local", projectId: "p", workspaceId: "w", root: "/first" };
    view.messageActionContext = { machine: { id: "local", name: "Local", kind: "local" }, session: { id: "same", cwd: "/first", archived: false, pending: false, busy: false } };
    view.messageActions = [{ id: "test:entry", title: "History", run: () => undefined, binding: { registrationPluginId: "test", sourcePluginId: "test" } }];
    let rejectAction: (error: Error) => void = () => { throw new Error("Action not started"); };
    view.onMessageAction = () => new Promise<void>((_resolve, reject) => { rejectAction = reject; });
    document.body.append(view);
    await settle(view);
    view.renderRoot.querySelector<HTMLButtonElement>(".msg-action")?.click();
    await settle(view);
    view.workspaceContext = { ...view.workspaceContext, root: "/second" };
    await settle(view);
    rejectAction(new Error("Old workspace failed"));
    await settle(view);
    expect(view.renderRoot.querySelector('[role="alert"]')).toBeNull();
  });
});

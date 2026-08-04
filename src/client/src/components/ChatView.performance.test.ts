// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatLine } from "./shared";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ChatView transcript element index", () => {
  it("reuses the DOM index for text-only updates and rebuilds it for structural changes", async () => {
    const user = message("user", "question");
    const view = await renderView([user, message("assistant", "partial")]);
    const root = view.shadowRoot;
    if (root === null) throw new Error("Missing ChatView shadow root");
    const querySelectorAll = vi.spyOn(root, "querySelectorAll");

    view.messages = [user, message("assistant", "partial answer")];
    await view.updateComplete;
    expect(querySelectorAll).not.toHaveBeenCalled();

    view.messages = [user, message("assistant", "partial answer"), message("user", "next")];
    await view.updateComplete;
    expect(querySelectorAll).toHaveBeenCalled();
  });

  it("looks up prepend markers from the cached map without querying the transcript", async () => {
    const view = await renderView([message("user", "question"), message("assistant", "answer")]);
    const root = view.shadowRoot;
    if (root === null) throw new Error("Missing ChatView shadow root");
    const querySelectorAll = vi.spyOn(root, "querySelectorAll");
    const lookup: unknown = Reflect.get(view, "scrollMarkerAt");
    if (!isMarkerLookup(lookup)) throw new Error("ChatView.scrollMarkerAt is unavailable");

    const marker = lookup.call(view, "m:0");

    expect(marker).toBeInstanceOf(HTMLElement);
    expect(querySelectorAll).not.toHaveBeenCalled();
  });
});

async function renderView(messages: ChatLine[]): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.messages = messages;
  view.messageTotal = messages.length;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function message(role: ChatLine["role"], text: string): ChatLine {
  return { role, parts: [{ type: "text", text }] };
}

type MarkerLookup = (this: ChatView, markerId: string) => HTMLElement | undefined;

function isMarkerLookup(value: unknown): value is MarkerLookup {
  return typeof value === "function";
}

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("ChatView durable message actions", () => {
  it("scopes render intent by machine, durable entry and part ordinal", async () => {
    const view = new ChatView();
    view.sessionId = "session";
    view.machineId = "remote";
    view.messages = [{ role: "user", entryId: "entry", parts: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }];
    document.body.append(view);
    await view.updateComplete;
    const identities = [...view.shadowRoot?.querySelectorAll<HTMLElement & { intentKey?: string }>("formatted-text") ?? []].map((element) => element.intentKey);
    expect(identities).toEqual([JSON.stringify(["remote", "session", "entry", 0]), JSON.stringify(["remote", "session", "entry", 1])]);
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { localization } from "../localization/browser";
import { ConversationSyncNotice } from "./ConversationSyncNotice";

let releaseCatalog: (() => void) | undefined;

afterEach(async () => {
  document.body.replaceChildren();
  vi.useRealTimers();
  localStorage.clear();
  releaseCatalog?.();
  releaseCatalog = undefined;
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

async function mount(state: ConversationSyncNotice["state"]) {
  const notice = new ConversationSyncNotice();
  notice.state = state;
  document.body.append(notice);
  await notice.updateComplete;
  return notice;
}

describe("conversation freshness notice", () => {
  it.each([undefined, "checked", "catching-up"] as const)("renders nothing for %s", async (state) => {
    const notice = await mount(state);
    expect(notice.shadowRoot?.textContent.trim()).toBe("");
    expect(notice.shadowRoot?.querySelector("div, [role], button")).toBeNull();
  });

  it.each([
    ["stale", "Chat may be out of date."],
    ["interrupted", "Could not refresh messages."],
  ] as const)("offers a refresh for %s and disappears after success", async (state, text) => {
    vi.useFakeTimers();
    const notice = await mount(state);
    if (state === "stale") {
      await vi.advanceTimersByTimeAsync(2_000);
      await notice.updateComplete;
    }
    const retry = vi.fn();
    notice.onRetry = retry;
    await notice.updateComplete;
    const button = notice.shadowRoot?.querySelector("button");
    expect(notice.shadowRoot?.querySelector('[role="status"] span')?.textContent).toBe(text);
    expect(button?.textContent).toBe("Refresh messages");
    expect(button?.type).toBe("button");
    button?.click();
    await notice.updateComplete;
    expect(retry).toHaveBeenCalledOnce();
    expect(notice.shadowRoot?.querySelector("button")).toBe(button);
    notice.state = "checked";
    await notice.updateComplete;
    expect(notice.shadowRoot?.querySelector("div, [role], button")).toBeNull();
  });

  it("keeps a quick resume silent and starts a fresh grace period for the next interruption", async () => {
    vi.useFakeTimers();
    const notice = await mount("checked");
    notice.state = "stale";
    await notice.updateComplete;
    await vi.advanceTimersByTimeAsync(1_999);
    expect(notice.shadowRoot?.querySelector('[role="status"]')).toBeNull();
    notice.state = "checked";
    await notice.updateComplete;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(notice.shadowRoot?.querySelector('[role="status"]')).toBeNull();
    notice.state = "stale";
    await notice.updateComplete;
    await vi.advanceTimersByTimeAsync(1_999);
    expect(notice.shadowRoot?.querySelector('[role="status"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await notice.updateComplete;
    expect(notice.shadowRoot?.querySelector('[role="status"] span')?.textContent).toBe("Chat may be out of date.");
  });

  it("shows a failed refresh immediately during the grace period", async () => {
    vi.useFakeTimers();
    const notice = await mount("stale");
    notice.state = "interrupted";
    await notice.updateComplete;
    expect(notice.shadowRoot?.querySelector("span")?.textContent).toBe("Could not refresh messages.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the grace period on disconnect and restarts it on reconnect", async () => {
    vi.useFakeTimers();
    const notice = await mount("stale");
    await vi.advanceTimersByTimeAsync(1_000);
    notice.remove();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    document.body.append(notice);
    await notice.updateComplete;
    await vi.advanceTimersByTimeAsync(1_999);
    expect(notice.shadowRoot?.querySelector('[role="status"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await notice.updateComplete;
    expect(notice.shadowRoot?.querySelector('[role="status"]')).not.toBeNull();
  });

  it("updates localized warning and action labels on a mounted notice", async () => {
    releaseCatalog = localization.registerCatalog({
      id: "conversation-sync-test", namespace: "core.conversationSyncNotice", locale: "de",
      load: () => Promise.resolve({
        stale: "Chat möglicherweise veraltet.",
        interrupted: "Nachrichten konnten nicht aktualisiert werden.",
        retry: "Nachrichten aktualisieren",
      }),
    });
    const notice = await mount("interrupted");
    await localization.setPreferences({ language: "de", formatLocale: "de-DE" });
    await notice.updateComplete;
    expect(notice.shadowRoot?.querySelector("span")?.textContent).toBe("Nachrichten konnten nicht aktualisiert werden.");
    expect(notice.shadowRoot?.querySelector("button")?.textContent).toBe("Nachrichten aktualisieren");
    notice.state = "stale";
    await notice.updateComplete;
    expect(notice.shadowRoot?.querySelector("span")?.textContent).toBe("Chat möglicherweise veraltet.");
  });
});

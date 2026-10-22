// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelectedSessionNotificationView } from "../sessionNotifications";
import { ChatView } from "./ChatView";

const notification = {
  id: "daemon-a:1", message: "plain <strong>text</strong>\nsecond line", truncated: false,
  severity: "warning" as const, receivedAt: "2026-07-18T00:00:00.000Z", order: 1,
};
function inbox(overrides: Partial<SelectedSessionNotificationView> = {}): SelectedSessionNotificationView {
  return {
    machineId: "local", sessionId: "session-1", cwd: "/repo", daemonInstanceId: "daemon-a",
    notifications: [notification], retainedCount: 1, discardedCount: 0, highestSeverity: "warning",
    dismissThrough: { order: 1, overflowWatermark: 0 }, pendingDismissedIds: new Set(),
    dismissAllPending: false, announcements: [], ...overrides,
  };
}
function required(view: ChatView, selector: string): HTMLElement {
  const element = view.renderRoot.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Expected ${selector}`);
  return element;
}
async function mount(value = inbox()) {
  const view = new ChatView();
  view.sessionId = value.sessionId;
  view.notificationInbox = value;
  view.onDismissNotification = vi.fn();
  view.onDismissAllNotifications = vi.fn();
  document.body.append(view);
  await view.updateComplete;
  return view;
}
async function settle(view: ChatView) {
  await view.updateComplete;
  await view.updateComplete;
}
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

describe("ChatView notification authorization links", () => {
  it("links OAuth URLs without changing their query or interpreting surrounding HTML", async () => {
    const url = "https://auth.example.com/authorize?response_type=code&client_id=pi&redirect_uri=http%3A%2F%2Flocalhost%3A54321%2Fcallback&scope=mcp%3Aread+offline_access&state=a%2Bb%26c&code_challenge=abc-_123&code_challenge_method=S256";
    const message = `<img src=x onerror="alert(1)"> Authorize: ${url}\n<strong>not markup</strong>`;
    const view = await mount(inbox({ notifications: [{ ...notification, message }] }));
    const content = required(view, ".notification-message");
    const link = required(view, ".notification-message a");
    expect(content.textContent).toBe(message);
    expect(content.querySelector("img, strong, script")).toBeNull();
    expect(link.getAttribute("href")).toBe(url);
    expect(link.textContent).toBe(url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("leaves unsafe schemes and malformed URLs as escaped text", async () => {
    const message = 'javascript:alert(1) data:text/html,<script>alert(1)</script> file:///tmp/auth javascript:https://evil.example https://[invalid] https://safe.example/" onclick="alert(1)';
    const view = await mount(inbox({ notifications: [{ ...notification, message }] }));
    const content = required(view, ".notification-message");
    expect(content.textContent).toBe(message);
    expect(content.querySelector("script")).toBeNull();
    const links = content.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://safe.example/");
    expect(links[0]?.hasAttribute("onclick")).toBe(false);
  });

  it("keeps prose punctuation outside links and balanced URL parentheses inside", async () => {
    const message = 'Open (https://example.com/auth?state=abc), then "http://localhost:1234/callback". See https://example.com/wiki/Topic_(detail).';
    const view = await mount(inbox({ notifications: [{ ...notification, message }] }));
    const content = required(view, ".notification-message");
    expect(content.textContent).toBe(message);
    expect(Array.from(content.querySelectorAll("a"), (link) => link.getAttribute("href"))).toEqual([
      "https://example.com/auth?state=abc", "http://localhost:1234/callback", "https://example.com/wiki/Topic_(detail)",
    ]);
  });

  it.each(["https://example.com/auth?state=partial", "https://example.com/auth?state=partial."])("does not link a truncated tail %s but keeps earlier complete URLs", async (tail) => {
    const message = `Open https://example.com/complete then ${tail}`;
    const view = await mount(inbox({ notifications: [{ ...notification, message, truncated: true }] }));
    const content = required(view, ".notification-message");
    expect(content.textContent).toBe(message);
    expect(Array.from(content.querySelectorAll("a"), (link) => link.getAttribute("href"))).toEqual(["https://example.com/complete"]);
    view.notificationInbox = inbox({ notifications: [{ ...notification, message: `${message}\n`, truncated: true }] });
    await settle(view);
    expect(required(view, ".notification-message").querySelectorAll("a")).toHaveLength(2);
  });

  it("never puts links in live announcements", async () => {
    const message = "Authorize at https://example.com/auth?state=secret";
    const view = await mount(inbox({ notifications: [{ ...notification, message }], announcements: [{ id: "auth", severity: "warning", message }] }));
    expect(required(view, ".notification-message").querySelectorAll("a")).toHaveLength(1);
    for (const region of view.renderRoot.querySelectorAll("[aria-live]")) {
      expect(region.querySelector("a")).toBeNull();
      expect(region.textContent).not.toContain("https://");
    }
  });

});

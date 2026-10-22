// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedSessionNotificationView } from "../sessionNotifications";
import { ChatView } from "./ChatView";
import { MANUAL_CHAT_BEHAVIORS } from "../chatBehaviors.testSupport";
import { setClientTranslations } from "../i18n";

beforeEach(() => { setClientTranslations("en", {}); });

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
  view.behaviors = MANUAL_CHAT_BEHAVIORS;
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

describe("ChatView", () => {
  it("keeps inline notification nodes stable across unrelated transcript updates and hides them on session switch", async () => {
    const value = inbox();
    const view = await mount(value);
    const tray = required(view, ".notification-tray");
    const row = required(view, "[data-notification-id]");
    const polite = required(view, ".notification-live[aria-live='polite']");
    required(view, ".notification-clear").click();
    expect(view.onDismissAllNotifications).toHaveBeenCalledOnce();
    view.messages = [{ role: "assistant", parts: [{ type: "text", text: "Unrelated reply" }] }];
    await settle(view);
    expect(required(view, ".notification-tray")).toBe(tray);
    expect(required(view, "[data-notification-id]")).toBe(row);
    expect(required(view, ".notification-live[aria-live='polite']")).toBe(polite);
    expect(view.notificationInbox).toBe(value);
    view.sessionId = "other";
    await settle(view);
    expect(view.renderRoot.querySelector(".notification-tray")).toBeNull();
    expect(polite.textContent).toBe("");
  });

  it.each([".notification-row-dismiss", ".notification-clear"])("recovers header focus after %s empties the tray, then releases it on focus exit", async (selector) => {
    const view = await mount();
    const button = required(view, selector);
    button.focus(); button.click();
    view.notificationInbox = inbox({ notifications: [], retainedCount: 0 });
    await settle(view);
    const header = required(view, "[data-notification-focus='header']");
    expect(view.shadowRoot?.activeElement).toBe(header);
    expect((view.renderRoot.querySelector(".notification-tray") === null)).toBe(false);
    if (selector === ".notification-clear") expect(view.onDismissAllNotifications).toHaveBeenCalledOnce();
    else expect(view.onDismissNotification).toHaveBeenCalledExactlyOnceWith(notification.id);
    const outside = document.createElement("button"); document.body.append(outside); outside.focus();
    await settle(view);
    expect(view.renderRoot.querySelector(".notification-tray")).toBeNull();
    expect((view.renderRoot.querySelector(".notification-tray") === null)).toBe(true);
  });

  it("focuses the adjacent surviving row after dismissal", async () => {
    const next = { ...notification, id: "daemon-a:2", order: 2 };
    const view = await mount(inbox({ notifications: [notification, next], retainedCount: 2 }));
    required(view, ".notification-row-dismiss").click();
    view.notificationInbox = inbox({ notifications: [next] });
    await settle(view);
    expect(view.shadowRoot?.activeElement).toBe(required(view, '[data-notification-id="daemon-a:2"]'));
  });

  it.each([{ machineId: "remote" }, { cwd: "/other" }, { sessionId: "session-2" }])("does not move pending dismissal focus across target change %j", async (target) => {
    const view = await mount();
    required(view, ".notification-clear").click();
    view.notificationInbox = inbox(target);
    if (target.sessionId !== undefined) view.sessionId = target.sessionId;
    await settle(view);
    expect(view.shadowRoot?.activeElement).toBeNull();
    view.notificationInbox = inbox({ ...target, notifications: [], retainedCount: 0 });
    await settle(view);
    expect(view.renderRoot.querySelector(".notification-tray")).toBeNull();
  });

  it("remembers collapse per exact chat across arrivals and session switches", async () => {
    const view = await mount();
    required(view, ".notification-toggle").click(); await settle(view);
    view.notificationInbox = inbox({ notifications: [{ ...notification, id: "daemon-a:2", order: 2 }, notification], retainedCount: 2 });
    await settle(view);
    expect(required(view, ".notification-list").hidden).toBe(true);
    expect(required(view, ".notification-toggle").getAttribute("aria-expanded")).toBe("false");
    for (const target of [{ cwd: "/other" }, { machineId: "remote" }, { sessionId: "session-2" }]) {
      view.notificationInbox = inbox(target); view.sessionId = target.sessionId ?? "session-1";
      await settle(view);
      expect(required(view, ".notification-list").hidden).toBe(false);
    }
    view.notificationInbox = inbox(); view.sessionId = "session-1"; await settle(view);
    expect(required(view, ".notification-list").hidden).toBe(true);
  });

  it("keeps stable live regions and announcement nodes, including when collapsed or empty", async () => {
    const warning = { id: "warning-1", severity: "warning" as const, message: "Notice" };
    const error = { id: "error-1", severity: "error" as const, message: "Failure" };
    const view = await mount(inbox({ announcements: [warning, error] }));
    const polite = required(view, '[aria-live="polite"]');
    const assertive = required(view, '[aria-live="assertive"]');
    const announcement = required(view, '[data-announcement-id="warning-1"]');
    expect(polite.textContent).toBe("Warning notification received.");
    expect(assertive.textContent).toBe("Error notification received.");
    expect(polite.contains(announcement)).toBe(true);
    required(view, ".notification-toggle").click(); await settle(view);
    view.notificationInbox = inbox({ notifications: [], retainedCount: 0, announcements: [warning, error] });
    await settle(view);
    expect((view.renderRoot.querySelector(".notification-tray") === null)).toBe(true);
    expect(required(view, '[aria-live="polite"]')).toBe(polite);
    expect(required(view, '[data-announcement-id="warning-1"]')).toBe(announcement);
    view.sessionId = "other"; await settle(view);
    expect(polite.textContent).toBe(""); expect(assertive.textContent).toBe("");
    expect(view.renderRoot.querySelector(".notification-tray")).toBeNull();
  });

  it("renders plain text, overflow, truncation and disabled pending actions using native buttons", async () => {
    const view = await mount(inbox({ notifications: [{ ...notification, truncated: true }], discardedCount: 3, pendingDismissedIds: new Set([notification.id]) }));
    expect(required(view, ".notification-message").textContent).toBe(notification.message);
    expect(view.renderRoot.querySelector(".notification-message strong")).toBeNull();
    expect(required(view, ".notification-overflow").textContent).toContain("3");
    expect(required(view, ".notification-truncated").textContent).not.toBe("");
    expect(required(view, ".notification-row-dismiss").hasAttribute("disabled")).toBe(true);
    for (const button of view.renderRoot.querySelectorAll(".notification-tray button")) expect(button.getAttribute("type")).toBe("button");
    const toggle = required(view, ".notification-toggle");
    expect(required(view, `#${String(toggle.getAttribute("aria-controls"))}`)).toBe(required(view, ".notification-list"));
    view.notificationInbox = inbox({ dismissAllPending: true }); await settle(view);
    expect(required(view, ".notification-clear").hasAttribute("disabled")).toBe(true);
    expect(required(view, ".notification-row-dismiss").hasAttribute("disabled")).toBe(true);
  });

  it("clears pending focus and empty retention when disconnected", async () => {
    const view = await mount();
    required(view, ".notification-clear").click();
    view.remove(); view.notificationInbox = inbox({ notifications: [], retainedCount: 0 });
    document.body.append(view); await settle(view);
    expect((view.renderRoot.querySelector(".notification-tray") === null)).toBe(true);
    expect(view.shadowRoot?.activeElement).toBeNull();
  });
});

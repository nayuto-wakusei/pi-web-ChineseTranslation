// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { SessionStatus } from "../api";
import { SessionNoticesPanel, type SessionNoticeDismissDetail } from "./SessionNoticesPanel";

const status: SessionStatus = {
  sessionId: "session", isStreaming: false, isCompacting: false, isBashRunning: false,
  pendingMessageCount: 0, queuedMessages: [], cost: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  warnings: [
    { severity: "error", message: "Raw <tag> العربية", source: "runtime", path: "/work/resource" },
    { severity: "warning", message: "Billing condition", dismiss: { id: "billing" } },
    { severity: "info", message: "Information" },
  ],
};
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

it("renders diagnostic data literally and emits only supported dismiss requests across shadow roots", async () => {
  const panel = new SessionNoticesPanel(); panel.status = status; panel.machineId = "machine";
  const frame = document.createElement("div");
  frame.attachShadow({ mode: "open" }).append(panel);
  const received = vi.fn<(event: Event) => void>();
  document.body.addEventListener("session-notice-dismiss", received);
  try {
    document.body.append(frame); await panel.updateComplete;
    const root = panel.shadowRoot;
    if (!root) throw new Error("Missing notices root");
    expect(root.querySelector(".session-warning-message")?.textContent).toBe(status.warnings?.[0]?.message);
    expect(root.querySelector(".session-warning-source")?.textContent).toBe("runtime");
    expect(root.querySelector(".session-warning-path")?.textContent).toBe("/work/resource");
    expect(root.querySelector("tag")).toBeNull();
    const buttons = root.querySelectorAll<HTMLButtonElement>(".session-warning-dismiss");
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    if (!button) throw new Error("Missing dismiss control");
    button.click();
    expect(received).toHaveBeenCalledOnce();
    const event = received.mock.calls[0]?.[0];
    if (!(event instanceof CustomEvent)) throw new Error("Expected custom dismiss event");
    const expected: SessionNoticeDismissDetail = { machineId: "machine", sessionId: "session", dismissId: "billing" };
    expect(event.detail).toEqual(expected);
    // The authoritative condition remains until the parent receives updated status.
    expect(panel.status).toBe(status);
    expect(status.warnings).toHaveLength(3);
    expect(button.isConnected).toBe(true);
  } finally { document.body.removeEventListener("session-notice-dismiss", received); }
});

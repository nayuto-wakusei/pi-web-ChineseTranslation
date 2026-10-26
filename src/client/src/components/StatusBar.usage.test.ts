// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { StatusBar } from "./StatusBar";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

it("renders host-provided context and session cost with semantic labels and keeps warnings actionable", async () => {
  const bar = new StatusBar();
  bar.status = {
    sessionId: "session", isStreaming: false, isCompacting: false, isBashRunning: false,
    pendingMessageCount: 0, queuedMessages: [],
    tokens: { input: 12000, output: 900, cacheRead: 0, cacheWrite: 0, total: 12900 },
    contextUsage: { tokens: 32000, contextWindow: 128000, percent: 25 }, cost: 0.1234,
  };
  bar.warningCount = 1;
  bar.onToggleWarnings = vi.fn();
  document.body.append(bar);
  await bar.updateComplete;
  expect(bar.shadowRoot?.querySelector(".context")?.textContent).toBe("25.0%/128k");
  expect(bar.shadowRoot?.querySelector(".context")?.getAttribute("title")).toBe("上下文用量");
  expect(bar.shadowRoot?.querySelector(".cost")?.textContent).toBe("$0.12");
  expect(bar.shadowRoot?.querySelector(".cost")?.getAttribute("title")).toBe("会话花费");
  bar.shadowRoot?.querySelector<HTMLButtonElement>(".warning-toggle")?.click();
  expect(bar.onToggleWarnings).toHaveBeenCalledOnce();

  bar.status = { ...bar.status, cost: 0 };
  delete bar.status.contextUsage;
  await bar.updateComplete;
  expect(bar.shadowRoot?.querySelector(".context")?.textContent).toBe("上下文未知");
  expect(bar.shadowRoot?.querySelector(".cost")?.textContent).toBe("$0");
});

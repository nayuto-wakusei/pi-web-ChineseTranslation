// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { localization } from "../localization/browser";
import { chatChromeMessages as messages } from "../chatChromeMessages";
import type { SessionStatus } from "../api";
import { SessionNoticesPanel } from "./SessionNoticesPanel";

let release: (() => void) | undefined;
afterEach(async () => {
  document.body.replaceChildren(); localStorage.clear(); release?.(); release = undefined;
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

it("translates the billing condition without replacing focused controls or rewriting raw diagnostics", async () => {
  release = localization.registerCatalog({ id: "billing-notice-test", namespace: "core.chatChrome", locale: "de", load: () => Promise.resolve({
    anthropicSubscriptionAuth: "Anthropic-Abonnement aktiv. Nutzung verwalten: {usageUrl}.",
  }) });
  const status: SessionStatus = {
    sessionId: "session", isStreaming: false, isCompacting: false, isBashRunning: false,
    pendingMessageCount: 0, queuedMessages: [], cost: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    warnings: [
      { severity: "warning", message: "Wire fallback", source: "anthropic", dismiss: { id: "anthropicExtraUsage" }, presentation: { kind: "anthropicSubscriptionAuth" } },
      { severity: "error", message: "Ordinary condition", source: "runtime" },
      { severity: "warning", message: "Wire fallback", source: "anthropic", dismiss: { id: "legacy-dismiss" } },
    ],
  };
  const panel = new SessionNoticesPanel(); panel.status = status; panel.machineId = "local";
  document.body.append(panel); await panel.updateComplete;
  const root = panel.shadowRoot;
  const button = root?.querySelector<HTMLButtonElement>(".session-warning-dismiss");
  if (!root || !button) throw new Error("Missing notice content");
  button.focus();
  const original = JSON.stringify(status);
  for (const language of ["de", "en"]) {
    await localization.setPreferences({ language, formatLocale: "en" }); await panel.updateComplete;
    expect(panel.status).toBe(status);
    expect(JSON.stringify(status)).toBe(original);
    expect(root.querySelector(".session-warning-message")?.textContent).toBe(messages.t("anthropicSubscriptionAuth", { usageUrl: "https://claude.ai/settings/usage" }));
    expect(root.querySelectorAll(".session-warning-message")[1]?.textContent).toBe("Ordinary condition");
    expect(root.querySelectorAll(".session-warning-message")[2]?.textContent).toBe("Wire fallback");
    expect(root.querySelector(".session-warning-dismiss")).toBe(button);
    expect(root.activeElement).toBe(button);
  }
});

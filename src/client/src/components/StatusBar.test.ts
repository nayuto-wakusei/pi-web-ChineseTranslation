// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../api";
import { localization } from "../localization/browser";
import { StatusBar, statusBarMessages as messages, statusBarWarningControlContent } from "./StatusBar";

const releases: (() => void)[] = [];
afterEach(async () => {
  document.body.replaceChildren();
  localStorage.clear();
  releases.splice(0).forEach((release) => { release(); });
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

describe("statusBarWarningControlContent", () => {
  it("provides an action label for both states while keeping only the count visible", () => {
    expect(statusBarWarningControlContent(1, true)).toEqual({ countText: "1", accessibleLabel: "Minimise 1 warning" });
    expect(statusBarWarningControlContent(3, false)).toEqual({ countText: "3", accessibleLabel: "Show 3 warnings in the warning area" });
  });

  it("omits the control content for invalid or absent warnings", () => {
    for (const count of [0, -1, 1.5, Number.NaN, Infinity]) expect(statusBarWarningControlContent(count, false)).toBeUndefined();
  });
});

it("updates every status variant live across a catalog, pseudo modes and English return", async () => {
  releases.push(localization.registerCatalog({ id: "status-bar-test", namespace: "core.statusBar", locale: "de", load: () => Promise.resolve({
    empty: "Noch kein Status", contextSize: "Kontext {size}", contextUsage: "{percent} von {size}", contextUnknown: "Kontext unbekannt",
    queued: "{count, plural, one {# vorgemerkt} other {# vorgemerkt}}",
    minimizeWarnings: "{count, plural, one {# Warnung minimieren} other {# Warnungen minimieren}}",
    showWarnings: "{count, plural, one {# Warnung anzeigen} other {# Warnungen anzeigen}}",
  }) }));
  const bar = new StatusBar();
  const onToggleWarnings = vi.fn();
  bar.warningCount = 1200;
  bar.onToggleWarnings = onToggleWarnings;
  document.body.append(bar);
  const snapshot = status();
  for (const language of ["en", "de", "en-XA", "ar-XB", "en"]) {
    await localization.setPreferences({ language, formatLocale: "de-DE" });
    bar.status = undefined;
    await bar.updateComplete;
    expect(bar.shadowRoot?.textContent).toContain(messages.t("empty"));
    for (const contextUsage of [undefined, { contextWindow: 128000, tokens: null, percent: null }, { contextWindow: 128000, tokens: 16000, percent: 12.5 }]) {
      bar.status = { ...snapshot, ...(contextUsage === undefined ? {} : { contextUsage }) };
      await bar.updateComplete;
      const context = bar.shadowRoot?.querySelector(".context");
      const size = new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 0 }).format(128000);
      expect(context?.textContent).toBe(contextUsage === undefined ? messages.t("contextUnknown") : contextUsage.percent === null ? messages.t("contextSize", { size }) : messages.t("contextUsage", {
        size, percent: new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(0.125),
      }));
      expect(bar.shadowRoot?.textContent).toContain(messages.t("queued", { count: 1200 }));
      expect(bar.shadowRoot?.textContent).toContain(new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 }).format(snapshot.tokens.input));
      expect(bar.shadowRoot?.textContent).toContain(new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(snapshot.cost));
    }
    const button = bar.shadowRoot?.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Missing warning toggle");
    button.focus();
    for (const expanded of [true, false]) {
      bar.warningsExpanded = expanded;
      await bar.updateComplete;
      expect(button.title).toBe(messages.t(expanded ? "minimizeWarnings" : "showWarnings", { count: 1200 }));
      expect(button.getAttribute("aria-label")).toBe(button.title);
      expect(button.getAttribute("aria-expanded")).toBe(String(expanded));
      expect(button.textContent).toContain(new Intl.NumberFormat("de-DE").format(1200));
      expect(bar.shadowRoot?.activeElement).toBe(button);
      button.click();
    }
    expect(bar.onToggleWarnings).toBe(onToggleWarnings);
    expect(snapshot.cost).toBe(12.34);
  }
  expect(onToggleWarnings).toHaveBeenCalledTimes(10);
  bar.status = { ...snapshot, pendingMessageCount: 0 };
  bar.warningCount = 0;
  await bar.updateComplete;
  expect(bar.shadowRoot?.querySelector("button")).toBeNull();
  expect(bar.shadowRoot?.textContent).not.toContain("queued");
});

it("preserves the focused warning control and status identity during a regional change", async () => {
  const bar = new StatusBar();
  const snapshot = status();
  bar.status = snapshot;
  bar.warningCount = 2;
  bar.onToggleWarnings = vi.fn();
  document.body.append(bar);
  await bar.updateComplete;
  const button = bar.shadowRoot?.querySelector("button");
  button?.focus();
  await localization.setPreferences({ language: "ar-XB", formatLocale: "ar-EG" });
  await bar.updateComplete;
  expect(bar.shadowRoot?.activeElement).toBe(button);
  expect(bar.status).toBe(snapshot);
  expect(button?.getAttribute("aria-label")).toBe(messages.t("showWarnings", { count: 2 }));
  expect(button?.textContent).toContain(new Intl.NumberFormat("ar-EG").format(2));
});

function status(): SessionStatus {
  return {
    sessionId: "session-1", isStreaming: true, isCompacting: false, isBashRunning: false,
    pendingMessageCount: 1200, queuedMessages: [],
    tokens: { input: 1234, output: 5678, cacheRead: 0, cacheWrite: 0, total: 6912 }, cost: 12.34,
  };
}

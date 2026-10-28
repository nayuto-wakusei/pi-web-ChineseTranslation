// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import type { SessionActivity } from "../api";
import { ConversationLayout, conversationActivityText, conversationLayoutMessages as messages, runtimeActivityMessages } from "./ConversationLayout";
import { localization } from "../localization/browser";
import { parseRuntimeActivityPresentation, runtimeActivityLabels, type RuntimeActivityPresentation } from "../../../shared/sessionActivityPresentation";

afterEach(async () => {
  document.body.replaceChildren();
  localStorage.clear();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

it("localizes every structured startup variant live without replacing the activity", async () => {
  const layout = new ConversationLayout();
  document.body.append(layout);
  for (const intent of ["create", "open"] as const) {
    for (const stage of ["runtime", "extensions"] as const) {
      for (const catalogRefreshing of [false, true]) {
        const activity: SessionActivity = {
          sessionId: "test", phase: "active", at: "2026-10-21T00:00:00Z", startup: true,
          label: "Do not match English labels", detail: "Raw fallback العربية <detail>",
          startupPresentation: { intent, stage, catalogRefreshing },
        };
        layout.activity = activity;
        for (const language of ["en", "en-XA", "ar-XB"]) {
          await localization.setPreferences({ language, formatLocale: "en" });
          await layout.updateComplete;
          const text = layout.shadowRoot?.querySelector('[aria-live="polite"]')?.textContent;
          const expected = messages.t("startup", { intent, stage, refreshing: catalogRefreshing ? "yes" : "no" });
          expect(text).toContain(expected);
          expect(text).not.toContain(activity.label);
          expect(text).not.toContain(activity.detail);
          expect(layout.activity).toBe(activity);
          if (language === "en") {
            expect(expected).toBe(`${intent === "create" ? "Creating" : "Opening"} session: ${stage === "runtime" ? "Starting the Pi session" : "Loading session extensions"}${catalogRefreshing ? " · provider model lists are refreshing" : ""}`);
          }
        }
      }
    }
  }
});

it("localizes every runtime activity kind live, preserving raw values as text", async () => {
  const layout = new ConversationLayout();
  document.body.append(layout);
  const staticCases = Object.keys(runtimeActivityLabels).map((kind) => {
    const presentation = parseRuntimeActivityPresentation({ kind });
    if (presentation === undefined) throw new Error("Missing known kind");
    return presentation;
  });
  const cases: RuntimeActivityPresentation[] = [
    ...staticCases,
    ...(["model", "thinking", "event"] as const).map((kind) => ({ kind, value: "<raw-value> العربية" })),
    { kind: "compactionCancelled", detailKind: "compactionCancelled" },
    { kind: "compactionCancelled", detailKind: "automaticCompactionCancelled" },
    { kind: "compactionFailed", detailKind: "compactionFailed" },
  ];
  for (const runtime of cases) {
    const activity: SessionActivity = {
      sessionId: "runtime", phase: "active", at: "now",
      label: "Do not match English", detail: "<raw-detail> العربية", runtimePresentation: runtime,
    };
    layout.activity = activity;
    for (const language of ["en", "en-XA", "ar-XB"]) {
      await localization.setPreferences({ language, formatLocale: "en" });
      await layout.updateComplete;
      const label = "value" in runtime ? runtimeActivityMessages.t(runtime.kind, { value: runtime.value }) : runtimeActivityMessages.t(runtime.kind);
      const detail = "detailKind" in runtime ? runtimeActivityMessages.t(`${runtime.detailKind}Detail`) : activity.detail ?? "";
      const region = layout.shadowRoot?.querySelector('[aria-live="polite"]');
      expect(region?.textContent).toContain(messages.t("summary", { label, detail }));
      expect(region?.textContent).not.toContain(activity.label);
      expect(region?.querySelector("raw-value, raw-detail")).toBeNull();
      expect(layout.activity).toBe(activity);
      if ("value" in runtime) expect(region?.textContent).toContain(runtime.value);
      if (!("detailKind" in runtime)) expect(region?.textContent).toContain(activity.detail);
      if (language === "en" && !("value" in runtime)) expect(label).toBe(runtimeActivityLabels[runtime.kind]);
    }
  }
});

it("retains raw runtime fallback for legacy, malformed and unknown presentation", async () => {
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  const base: SessionActivity = { sessionId: "legacy", phase: "active", at: "now", label: "running tool", detail: "raw detail" };
  const expected = messages.t("summary", { label: base.label, detail: base.detail ?? "" });
  expect(conversationActivityText(undefined, base, false)).toBe(expected);
  expect(conversationActivityText(undefined, {
    ...base,
    // @ts-expect-error A newer server can add unknown kinds.
    runtimePresentation: { kind: "future" },
  }, false)).toBe(expected);
});

it("preserves raw startup fallback without metadata or for unknown future stages", async () => {
  const activity: SessionActivity = {
    sessionId: "legacy", phase: "active", at: "now", startup: true,
    label: "Creating session", detail: "Starting the Pi session",
  };
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  const expected = messages.t("summary", { label: activity.label, detail: activity.detail ?? "" });
  expect(conversationActivityText(undefined, activity, false)).toBe(expected);
  const futureActivity: SessionActivity = {
    ...activity,
    startupPresentation: {
      intent: "create", catalogRefreshing: false,
      // @ts-expect-error A newer server may add stages unknown to this browser.
      stage: "future-stage",
    },
  };
  expect(conversationActivityText(undefined, futureActivity, false)).toBe(expected);
});

it("updates the activity live region without replacing activity or status objects", async () => {
  const layout = new ConversationLayout();
  const activity = { sessionId: "test", phase: "active" as const, label: "Raw label العربية", detail: "<runtime detail>", at: "2026-10-21T00:00:00Z" };
  layout.activity = activity;
  document.body.append(layout);
  await layout.updateComplete;
  const region = layout.shadowRoot?.querySelector('[aria-live="polite"]');
  expect(region?.textContent).toContain("Raw label العربية: <runtime detail>");
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    await layout.updateComplete;
    expect(region?.textContent).toContain(messages.t("summary", { label: activity.label, detail: activity.detail }));
    expect(region?.textContent).toContain(activity.label);
    expect(region?.textContent).toContain(activity.detail);
  }
  layout.sending = true;
  await layout.updateComplete;
  expect(region?.textContent).toContain(messages.t("sending"));
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  await layout.updateComplete;
  expect(region?.textContent).toContain("Sending your message…");
  layout.sending = false;
  layout.activity = undefined;
  layout.status = { sessionId: "test", isStreaming: true, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
  await layout.updateComplete;
  expect(region?.textContent).toContain("running");
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  await layout.updateComplete;
  expect(region?.textContent).toContain(messages.t("running"));
  layout.status = { ...layout.status, isStreaming: false };
  await layout.updateComplete;
  expect(region?.textContent.trim()).toBe("");
});

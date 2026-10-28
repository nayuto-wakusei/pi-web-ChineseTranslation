import { afterEach, expect, it } from "vitest";
import { localization } from "./localization/browser";
import { commandResultMessages, localizedCommandResult } from "./commandResultMessages";
import definitions from "./commandResults.messages";
import { parseCommandResult } from "./api/parsers";
import type { CommandFeedback, CommandResultPresentation } from "../../shared/commandResultPresentation";

afterEach(async () => { await localization.setPreferences({ language: "en", formatLocale: "en" }); });

const stats = { sessionId: "raw-id", totalMessages: 1234, userMessages: 1200, assistantMessages: 34, toolCalls: 56,
  tokens: { input: 123456, output: 7890, total: 131346 }, cost: 1234.5678 };
const feedback: CommandFeedback[] = [
  { code: "unknown", command: "<raw-command>" }, { code: "notImplemented", command: "login" },
  { code: "named", name: "<raw name>" }, { code: "reloadFailed", detail: "<raw diagnostic>" },
  { code: "treeFailed", detail: "<raw diagnostic>" }, { code: "replacementActive", command: "fork" },
  { code: "replacementActive", command: "clone" }, { code: "stats", stats },
];

it("validates all static source messages and renders every feedback kind in English and pseudo modes", async () => {
  const allFeedback = [...feedback];
  for (const code of Object.keys(definitions)) {
    const result = parseCommandResult({ type: "done", message: "fallback", presentation: { kind: "commandResult", feedback: { code } } });
    if (result.type === "done" && result.presentation !== undefined) allFeedback.push(result.presentation.feedback);
  }
  expect(allFeedback).toHaveLength(24);
  for (const data of allFeedback) {
    const presentation: CommandResultPresentation = { kind: "commandResult", feedback: data };
    for (const language of ["en", "en-XA", "ar-XB"]) {
      await localization.setPreferences({ language, formatLocale: "en" });
      const output = localizedCommandResult(presentation);
      expect(output.length).toBeGreaterThan(0);
      if (language === "en-XA") expect(output).toContain("［");
      if (language === "ar-XB") expect(output).toContain("\u202e");
      if ("detail" in data) expect(output).toContain(data.detail);
      if ("name" in data) expect(output).toContain(data.name);
      if (data.code === "unknown") expect(output).toContain(data.command);
    }
  }
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  expect(commandResultMessages.t("nameUsage")).toBe("Usage: /name <session name>");
});

it("formats statistics regionally with explicit USD, never inferring currency from locale", async () => {
  await localization.setPreferences({ language: "en", formatLocale: "ar-EG" });
  const output = localizedCommandResult({ kind: "commandResult", feedback: { code: "stats", stats } });
  expect(output).toContain("raw-id");
  for (const number of [1234, 1200, 34, 56, 123456, 7890, 131346]) expect(output).toContain(new Intl.NumberFormat("ar-EG").format(number));
  expect(output).toContain(new Intl.NumberFormat("ar-EG", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(stats.cost));
});

it.each([undefined, null, [], { kind: "future" },
  { kind: "commandResult", feedback: { code: "future" } },
  { kind: "commandResult", feedback: { code: "named", name: 7 } },
  { kind: "commandResult", feedback: { code: "reloadFailed" } },
  { kind: "commandResult", feedback: { code: "unknown", command: false } },
  { kind: "commandResult", feedback: { code: "replacementActive", command: "delete" } },
  { kind: "commandResult", feedback: { code: "stats", stats: { ...stats, cost: Infinity } } },
  { kind: "commandResult", feedback: { code: "stats", stats: { ...stats, tokens: { ...stats.tokens, total: "1" } } } },
])("falls back to raw command-result text for malformed/future metadata %#", (presentation) => {
  for (const type of ["done", "unsupported", "select"]) {
    const result = parseCommandResult({ type, message: "raw wire text", title: "raw title", requestId: "request", options: [], presentation });
    expect(result).not.toHaveProperty("presentation");
  }
});

it.each(feedback)("retains validated dynamic metadata across the HTTP parser: $code", (data) => {
  const presentation: CommandResultPresentation = { kind: "commandResult", feedback: data };
  expect(parseCommandResult({ type: "done", message: "raw wire text", presentation })).toEqual({ type: "done", message: "raw wire text", presentation });
});

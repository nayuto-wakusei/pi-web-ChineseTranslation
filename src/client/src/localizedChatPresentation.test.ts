import { afterEach, expect, it } from "vitest";
import { localization } from "./localization/browser";
import { chatTranscriptMessages as messages } from "./chatTranscriptMessages";
import { localizedArgumentSummary, localizedChatText } from "./localizedChatPresentation";
import { argumentSummaryPresentation, summarizeArgs } from "./chatPresentation";
import { normalizeMessages } from "./chatMessages";
import { applyTranscriptEvent } from "./chatTranscript";

afterEach(async () => { await localization.setPreferences({ language: "en", formatLocale: "en" }); });

it("localizes every generated argument shape but never rewrites keys, primitive values, paths or commands", async () => {
  await localization.setPreferences({ language: "ar-XB", formatLocale: "ar-EG" });
  const args = { questions: Array.from({ length: 12 }, () => "raw"), config: { value: 1 }, raw: "<tag> العربية" };
  expect(localizedArgumentSummary({ kind: "arguments", args })).toBe(`questions: ${messages.t("argsItems", { count: 12 })} · config: ${messages.t("argsObject")} · raw: <tag> العربية`);
  expect(localizedArgumentSummary({ kind: "arguments", args: { edits: [1, 2] } })).toBe(messages.t("argsEdits", { count: 2 }));
  expect(localizedArgumentSummary({ kind: "arguments", args: { oldText: "a", newText: "b" } })).toBe(messages.t("argsReplacement"));
  for (const args of [{ path: "raw/path" }, { command: "echo edits" }]) expect(argumentSummaryPresentation(args)).toEqual({});
  expect(summarizeArgs({ edits: [1, 2] })).toBe("2 edits");
  expect(summarizeArgs(args)).toBe("questions: 12 items · config: object · raw: <tag> العربية");
});

it("retains provenance through history coalescing, live starts, result updates and finalization", () => {
  const args = { edits: [{ oldText: "old", newText: "new" }] };
  const call = { role: "assistant", content: [{ type: "toolCall", name: "edit", id: "call", arguments: args }] };
  const result = { role: "toolResult", toolName: "edit", toolCallId: "call", content: "done" };
  const history = normalizeMessages([call, result]);
  let live = applyTranscriptEvent([], { type: "tool.start", toolName: "edit", toolCallId: "call", summary: "provider-generated summary", args }) ?? [];
  live = applyTranscriptEvent(live, { type: "tool.update", toolCallId: "call", toolName: "edit", text: "working", content: undefined, details: undefined }) ?? live;
  live = applyTranscriptEvent(live, { type: "message.end", message: result }) ?? live;
  expect(history[0]?.parts[0]).toHaveProperty("summaryPresentation", { kind: "arguments", args });
  expect(live[0]?.parts[0]).toHaveProperty("summaryPresentation", { kind: "arguments", args });
  const supplied = applyTranscriptEvent([], { type: "tool.start", toolCallId: "raw", toolName: "plugin", summary: "Raw plugin summary" });
  expect(supplied?.[0]?.parts[0]).not.toHaveProperty("summaryPresentation");
});

it("retains source-compatible English while resolving shell metadata and failures in the current locale", async () => {
  const lines = normalizeMessages([
    { role: "bashExecution", command: "echo '<raw>'", output: "raw output العربية", exitCode: 1234, excludeFromContext: true, cancelled: true, truncated: true, fullOutputPath: "/raw/<path>" },
    { role: "assistant", stopReason: "error", errorMessage: "  <img src=x> raw failure  " },
    { role: "assistant", stopReason: "error", errorMessage: "  " },
    { role: "user", content: [{ type: "image" }] },
    { role: "system", content: { questions: [1, 2] } },
  ]);
  for (const language of ["en", "en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: language === "en" ? "en" : "ar-EG" });
    const displayed = lines.flatMap((line) => line.parts.flatMap((part) => part.type === "text" && part.presentation !== undefined ? [localizedChatText(part.presentation)] : []));
    expect(displayed[0]).toBe([
      messages.t("shellExcluded"), "", "$ echo '<raw>'", "", "raw output العربية", "", messages.t("shellExit", { code: "1234" }), "",
      messages.t("shellCancelled"), "", messages.t("shellTruncated"), "", messages.t("shellFullOutput", { path: "/raw/<path>" }),
    ].join("\n"));
    expect(displayed[1]).toBe(messages.t("modelFailure", { detail: "<img src=x> raw failure", detailed: "yes" }));
    expect(displayed[2]).toBe(messages.t("modelFailure", { detail: "", detailed: "no" }));
    expect(displayed[3]).toBe(messages.t("imagePlaceholder"));
    expect(displayed[4]).toBe(`questions: ${messages.t("argsItems", { count: 2 })}`);
    if (language === "en") for (const [index, line] of lines.entries()) expect(line.parts[0]).toHaveProperty("text", displayed[index]);
  }
});

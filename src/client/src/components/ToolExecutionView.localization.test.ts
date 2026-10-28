// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { localization } from "../localization/browser";
import { toolExecutionMessages as messages } from "../toolExecutionMessages";
import { ToolExecutionView } from "./ToolExecutionView";
import { writeClipboardText } from "../clipboard";
import { applyTranscriptEvent } from "../chatTranscript";
import { parseSessionStreamEvent } from "../api/parsers";
import definitions from "./toolExecution.messages";

vi.mock("../clipboard", () => ({ writeClipboardText: vi.fn(() => Promise.resolve(true)) }));
let release: (() => void) | undefined;
afterEach(async () => {
  document.body.replaceChildren();
  release?.();
  release = undefined;
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected tool card element");
  return value;
}
async function language(view: ToolExecutionView, language: string): Promise<void> {
  await localization.setPreferences({ language, formatLocale: "ar-EG" });
  await view.updateComplete;
}

it("localizes parsed edit preview progress live without translating diagnostics, legacy or final output", async () => {
  release = localization.registerCatalog({ id: "edit-progress-test", namespace: "core.toolExecution", locale: "de", load: () => Promise.resolve({
    ...Object.fromEntries(Object.entries(definitions).map(([key, descriptor]) => [key, descriptor.message])),
    previewComputed: "Bearbeitungsvorschau berechnet.",
  }) });
  const started = applyTranscriptEvent([], { type: "tool.start", toolName: "edit", toolCallId: "edit-1", summary: "raw <img>.ts", args: { path: "raw <img>.ts" } }) ?? [];
  const diagnostic = "Could not edit raw <img>.ts: ENOENT";
  const event = { type: "tool.update", toolName: "edit", toolCallId: "edit-1", text: "Edit preview computed.", details: { preview: { error: diagnostic }, presentation: { kind: "editPreviewComputed" } } };
  const lines = applyTranscriptEvent(started, parseSessionStreamEvent(event)) ?? started;
  const execution = lines[0]?.parts[0];
  if (execution?.type !== "toolExecution") throw new Error("Expected edit execution");
  const view = new ToolExecutionView();
  view.execution = execution;
  document.body.append(view);
  await view.updateComplete;
  const root = required(view.shadowRoot);
  const details = required(root.querySelector<HTMLDetailsElement>(".text-body"));
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
  await view.updateComplete;
  const summary = required(details.querySelector("summary"));
  summary.focus();
  const result = required(root.querySelector(".detail-result pre"));
  for (const locale of ["de", "en-XA", "ar-XB", "en"]) {
    await language(view, locale);
    expect(root.querySelector(".detail-result pre")).toBe(result);
    expect(result.textContent).toBe(messages.t("previewComputed"));
    expect(root.querySelector(".error-text")?.textContent).toBe(diagnostic);
    expect(root.querySelector(".detail-target-value")?.textContent).toBe("raw <img>.ts");
    expect(root.querySelector("img")).toBeNull();
    expect(root.activeElement).toBe(summary);
    expect(details.open).toBe(true);
    expect(view.execution).toBe(execution);
    expect(execution.resultText).toBe(event.text);
  }
  await language(view, "ar-XB");
  for (const presentation of [undefined, { kind: "future" }, { kind: 42 }, "editPreviewComputed"]) {
    view.execution = { ...execution, details: { presentation } };
    await view.updateComplete;
    expect(result.textContent).toBe(event.text);
  }
  // Even unchanged English final output is data, not an English-matched key.
  view.execution = { ...execution, status: "success" };
  await view.updateComplete;
  expect(result.textContent).toBe(event.text);
  view.execution = { ...execution, toolName: "external" };
  await view.updateComplete;
  expect(result.textContent).toBe(event.text);
});

it("updates complete diff controls and regional counts without losing expansion, focus or copied state", async () => {
  vi.useFakeTimers();
  release = localization.registerCatalog({ id: "tool-test", namespace: "core.toolExecution", locale: "de", load: () => Promise.resolve({
    copyDiff: "Diff kopieren", copied: "Kopiert", appliedDiff: "Angewendeter Diff",
  }) });
  const view = new ToolExecutionView();
  const diff = Array.from({ length: 201 }, (_, i) => `+Raw <b>line</b> ${String(i)} العربية`).join("\n");
  view.execution = { type: "toolExecution", toolName: "edit", summary: "Raw summary", args: { path: "Raw <img> العربية.ts", edits: [{}, {}] }, status: "success", details: { diff }, preview: { diff: "old preview" } };
  document.body.append(view);
  await view.updateComplete;
  const root = required(view.shadowRoot);
  const details = required(root.querySelector<HTMLDetailsElement>(".diff-details"));
  const copy = required(root.querySelector<HTMLButtonElement>(".diff-toolbar button"));
  const showMore = required(root.querySelector<HTMLButtonElement>(".show-more"));
  for (const locale of ["de", "en-XA", "ar-XB"]) {
    await language(view, locale);
    expect(root.querySelector(".diff-details")).toBe(details);
    expect(details.open).toBe(true);
    expect(root.querySelector(".show-more")).toBe(showMore);
    expect(showMore.textContent.trim()).toBe(messages.t("showAll", { count: 201 }));
    expect(root.querySelector("summary small")?.textContent).toBe(messages.t("lines", { count: 201 }));
    expect(root.querySelector(".diff-toolbar span")?.textContent).toBe(messages.t("showing", { visible: 180, total: 201 }));
    expect(root.querySelector(".notice")?.textContent).toBe(messages.t("mismatch"));
    expect(root.querySelector(".tool-meta > span")?.textContent).toBe(messages.t("edits", { count: 2 }));
    expect(root.querySelector(".added")?.textContent).toBe(localization.number(201, { signDisplay: "always" }));
    expect(root.querySelector(".path")?.getAttribute("aria-label")).toBe(messages.t("targetDescription", { kind: "file", text: "Raw <img> العربية.ts" }));
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".diff")?.getAttribute("dir")).toBe("ltr");
  }
  showMore.click();
  await view.updateComplete;
  expect(root.querySelectorAll(".diff-content > span")).toHaveLength(201);
  copy.focus();
  copy.click();
  await vi.advanceTimersByTimeAsync(0);
  await view.updateComplete;
  await language(view, "de");
  expect(root.activeElement).toBe(copy);
  expect(root.querySelector(".diff-toolbar button")).toBe(copy);
  expect(copy.textContent).toBe("Kopiert");
  expect(root.querySelectorAll(".diff-content > span")).toHaveLength(201);
  expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(diff);
  details.open = false;
  details.dispatchEvent(new Event("toggle"));
  await view.updateComplete;
  await language(view, "ar-XB");
  expect(details.open).toBe(false);
  expect(root.querySelector(".diff")).toBeNull();
  await vi.advanceTimersByTimeAsync(1200);
});

it("localizes every status and target kind while retaining raw result text and disclosure choice", async () => {
  const view = new ToolExecutionView();
  view.execution = { type: "toolExecution", toolName: "bash", summary: "Input <b>raw</b>", args: { command: "echo العربية <b>" }, status: "error", resultText: "Raw failed <img>" };
  document.body.append(view);
  await view.updateComplete;
  const root = required(view.shadowRoot);
  const details = required(root.querySelector<HTMLDetailsElement>(".text-body"));
  expect(details.open).toBe(true);
  for (const locale of ["en-XA", "ar-XB"]) {
    await language(view, locale);
    expect(root.querySelector(".detail-label")?.textContent).toBe(messages.t("targetLabel", { kind: "command" }));
    expect(root.querySelector(".detail-target-value")?.textContent).toBe("echo العربية <b>");
    expect(root.querySelector(".detail-result pre")?.textContent).toBe("Raw failed <img>");
    expect(root.querySelector(".error-text")?.textContent).toBe("Raw failed <img>");
    expect(root.querySelector("img, b")).toBeNull();
  }
  details.open = false;
  details.dispatchEvent(new Event("toggle"));
  await view.updateComplete;
  for (const status of ["pending", "running", "success", "error"] as const) {
    view.execution = { ...view.execution, status, args: {} };
    await view.updateComplete;
    await language(view, "en-XA");
    expect(root.querySelector(".status-label")?.textContent).toBe(messages.t("status", { status }));
    expect(root.querySelector(".summary")?.getAttribute("aria-label")).toBe(messages.t("targetDescription", { kind: "input", text: "Input <b>raw</b>" }));
    if (status !== "error") expect(details.open).toBe(false);
  }
  // A new error intentionally opens the result, independently of localization.
  expect(details.open).toBe(true);
});

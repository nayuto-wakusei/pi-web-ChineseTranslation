// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();
import { afterEach, expect, it } from "vitest";
import { localization } from "../localization/browser";
import { chatTranscriptMessages as messages } from "../chatTranscriptMessages";
import transcriptDefinitions from "./chatTranscript.messages";
import { ChatView, chatMessageMetadataLabel } from "./ChatView";
import { TranscriptImage } from "./TranscriptImage";
import type { MessageActionsMenu } from "./chat/MessageActionsMenu";
import type { ImageGalleryDialog } from "./ImageGalleryDialog";
import { imagePresentation, settleImage } from "./imagePresentation.testSupport";
import { summarizeChatGroup } from "../chatGroups";
import { localizedChatGroupSummary } from "./chat/transcriptLabels";
import { normalizeMessages } from "../chatMessages";
import { applyTranscriptEvent } from "../chatTranscript";
import { localizedCommandResult } from "../commandResultMessages";
import { localizedChatText, localizedArgumentSummary } from "../localizedChatPresentation";
import type { ToolExecutionView } from "./ToolExecutionView";
import type { ChatLine } from "../chatTypes";

let release: (() => void) | undefined;
afterEach(async () => {
  document.body.replaceChildren();
  release?.(); release = undefined;
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  localStorage.clear();
});
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected transcript control");
  return value;
}
async function language(view: ChatView, language: string): Promise<void> {
  await localization.setPreferences({ language, formatLocale: "ar-EG", timeZone: "Asia/Tokyo", hourCycle: "h23" });
  await view.updateComplete;
}

it("updates metadata, role headings and part disclosures without replacing controls or raw content", async () => {
  release = localization.registerCatalog({ id: "transcript-test", namespace: "core.chatTranscript", locale: "de", load: () => Promise.resolve({
    thinking: "Gedanken", information: "Nachrichteninformationen", actions: "Nachrichtenaktionen",
  }) });
  const timestamp = "2026-10-15T20:10:00Z";
  const view = new ChatView();
  view.behaviors = { ...view.behaviors, followTail: false, rememberPosition: false };
  view.messages = [{ role: "assistant", entryId: "reply", meta: { timestamp, model: { id: "Raw <model>" }, thinkingLevel: "high" }, parts: [
    { type: "thinking", text: "Raw thinking <tag> العربية" }, { type: "text", text: "Raw reply" },
  ] }, { role: "skill", entryId: "skill", parts: [
    { type: "skillInvocation", name: "Raw <skill>", location: "/raw/path", content: "Raw source" },
    { type: "skillRead", name: "Raw <skill>", path: "/raw/<path>" },
  ] }, { role: "tool", entryId: "result", parts: [{ type: "toolResult", toolName: "raw_tool", text: "Raw failure", isError: true }] }];
  document.body.append(view); await view.updateComplete;
  const root = required(view.shadowRoot);
  // The historical activity group is collapsed; opening it renders its cached body.
  const group = required(root.querySelector<HTMLDetailsElement>(".event-group"));
  for (const details of root.querySelectorAll<HTMLDetailsElement>(".event-group")) {
    details.open = true; details.dispatchEvent(new Event("toggle"));
  }
  await view.updateComplete;
  const thinking = required(root.querySelector<HTMLDetailsElement>(".thinking"));
  const skill = required(root.querySelector<HTMLDetailsElement>(".skill-invocation"));
  skill.open = true; skill.dispatchEvent(new Event("toggle")); await view.updateComplete;
  const info = required(root.querySelector<HTMLButtonElement>(".msg-meta"));
  info.click(); await view.updateComplete; info.focus();
  for (const locale of ["de", "en-XA", "ar-XB"]) {
    await language(view, locale);
    expect(root.querySelector(".msg-meta")).toBe(info);
    expect(root.activeElement).toBe(info);
    expect(info.getAttribute("aria-label")).toBe(messages.t("information"));
    expect(info.getAttribute("aria-expanded")).toBe("true");
    expect(group.open).toBe(true); expect(skill.open).toBe(true); expect(thinking.open).toBe(true);
    expect(thinking.querySelector("summary")?.textContent).toBe(messages.t("thinking"));
    expect(root.querySelector(".skill-read strong")?.textContent).toBe(messages.t("loadedSkill", { name: "Raw <skill>" }));
    expect(root.querySelector(".skill-read small")?.textContent).toBe(messages.t("readSkill", { path: "/raw/<path>" }));
    expect(root.querySelector(".tool-result summary")?.textContent).toContain(messages.t("toolResult", { name: "raw_tool", failed: "yes" }));
    expect(root.querySelector(".msg .visually-hidden")?.textContent).toBe(messages.t("role", { role: "assistant" }));
    expect(root.querySelector(".msg-meta-details")?.textContent).toBe(chatMessageMetadataLabel(required(view.messages[0])));
    const menu = required(root.querySelector<MessageActionsMenu>("pi-message-actions-menu"));
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector("button")?.getAttribute("aria-label")).toBe(messages.t("actions"));
    expect(thinking.querySelector("formatted-text")).toHaveProperty("text", "Raw thinking <tag> العربية");
    expect(root.querySelector("skill, model, .skill-read path")).toBeNull();
  }
  const expectedDate = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Tokyo", hourCycle: "h23" }).format(new Date(timestamp));
  expect(chatMessageMetadataLabel(required(view.messages[0]))).toBe(localization.list([expectedDate, "Raw <model>", "高"]));
  expect(chatMessageMetadataLabel({ role: "user", parts: [], meta: { timestamp: "invalid" } })).toBe(messages.t("noMetadata"));
  thinking.open = false; thinking.dispatchEvent(new Event("toggle")); await view.updateComplete;
  await language(view, "de");
  expect(thinking.open).toBe(false); expect(thinking.querySelector("formatted-text")).toBeNull();
});

it("resolves normalized generated prose live without translating source or replacing disclosure state", async () => {
  const raw = "Model response failed: raw source <tag>";
  const view = new ChatView();
  view.behaviors = { ...view.behaviors, followTail: false, rememberPosition: false };
  view.messages = normalizeMessages([
    { role: "bashExecution", command: "echo '<raw>'", output: raw, exitCode: 1, cancelled: true, truncated: true, fullOutputPath: "/raw/path" },
    { role: "assistant", stopReason: "error", errorMessage: "<img src=x> diagnostic" },
    { role: "assistant", content: [{ type: "toolCall", name: "edit", id: "edit", arguments: { edits: [1, 2] } }] },
    { role: "user", content: raw },
  ]);
  document.body.append(view); await view.updateComplete;
  const root = required(view.shadowRoot);
  for (const group of root.querySelectorAll<HTMLDetailsElement>(".event-group")) {
    group.open = true; group.dispatchEvent(new Event("toggle"));
  }
  await view.updateComplete;
  const shell = required(root.querySelector(".shell-output"));
  const generated = required(root.querySelector(".generated-text"));
  const tool = required(root.querySelector<ToolExecutionView>("tool-execution-view"));
  await tool.updateComplete;
  const details = required(tool.shadowRoot?.querySelector<HTMLDetailsElement>("details"));
  details.open = true; details.dispatchEvent(new Event("toggle")); await tool.updateComplete;
  const summary = required(details.querySelector<HTMLElement>("summary"));
  summary.focus();
  for (const locale of ["en-XA", "ar-XB", "en"]) {
    await language(view, locale); await tool.updateComplete;
    expect(root.querySelector(".shell-output")).toBe(shell);
    expect(root.querySelector(".generated-text")).toBe(generated);
    expect(root.querySelector("tool-execution-view")).toBe(tool);
    expect(tool.shadowRoot?.activeElement).toBe(summary);
    expect(details.open).toBe(true);
    const shellPart = view.messages[0]?.parts[0];
    const errorPart = view.messages[1]?.parts[0];
    if (shellPart?.type !== "text" || shellPart.presentation === undefined || errorPart?.type !== "text" || errorPart.presentation === undefined) throw new Error("Missing generated provenance");
    expect(shell.textContent).toBe(localizedChatText(shellPart.presentation));
    expect(generated.textContent).toBe(localizedChatText(errorPart.presentation));
    expect(generated.querySelector("img")).toBeNull();
    expect(tool.shadowRoot?.querySelector(".generated-summary")?.textContent).toBe(localizedArgumentSummary({ kind: "arguments", args: { edits: [1, 2] } }));
    expect(Array.from(root.querySelectorAll("formatted-text")).some((node) => "text" in node && node.text === raw)).toBe(true);
  }
});

it("localizes live shell starts, chunks and completion notes without rewriting output or replacing the shell node", async () => {
  release = localization.registerCatalog({ id: "live-shell-test", namespace: "core.chatTranscript", locale: "de", load: () => Promise.resolve({
    ...Object.fromEntries(Object.entries(transcriptDefinitions).map(([key, definition]) => [key, definition.message])),
    shellExcluded: "Vom Kontext ausgeschlossen", shellExit: "Status {code}", shellCancelled: "abgebrochen",
    shellTruncated: "Ausgabe gekürzt", shellFullOutput: "Vollständige Ausgabe: {path}",
    shellNoOutput: "(keine Ausgabe)", shellFailed: "Bash-Befehl fehlgeschlagen",
  }) });
  const command = "echo '<raw>'";
  const raw = "cancelled\noutput truncated <img src=x> العربية";
  const view = new ChatView();
  view.behaviors = { ...view.behaviors, followTail: false, rememberPosition: false };
  view.messages = required(applyTranscriptEvent([], { type: "shell.start", command, excludeFromContext: true }));
  document.body.append(view); await view.updateComplete;
  const root = required(view.shadowRoot);
  const shell = required(root.querySelector(".shell-output"));
  for (const event of [
    { type: "shell.chunk", chunk: "cancelled\n" },
    { type: "shell.chunk", chunk: "output truncated <img src=x> العربية" },
    { type: "shell.end", exitCode: 1234, cancelled: true, truncated: true, fullOutputPath: "/raw/<path>" },
  ] as const) {
    view.messages = required(applyTranscriptEvent(view.messages, event));
    await view.updateComplete;
    expect(root.querySelector(".shell-output")).toBe(shell);
  }
  const retained = view.messages;
  for (const locale of ["de", "en-XA", "ar-XB", "en"]) {
    await language(view, locale);
    expect(root.querySelector(".shell-output")).toBe(shell);
    expect(shell.textContent).toBe([
      messages.t("shellExcluded"), "", `$ ${command}`, "", raw, "",
      messages.t("shellExit", { code: "1234" }), messages.t("shellCancelled"), messages.t("shellTruncated"), messages.t("shellFullOutput", { path: "/raw/<path>" }),
    ].join("\n"));
    expect(shell.querySelector("img, raw, path")).toBeNull();
    expect(view.messages).toBe(retained);
  }

  let empty: ChatLine[] = [];
  for (const event of [
    { type: "shell.start", command: "false" }, { type: "shell.end", isError: true },
    { type: "shell.start", command: "false" }, { type: "shell.end", isError: true, output: "Bash command failed" },
  ] as const) empty = required(applyTranscriptEvent(empty, event));
  view.messages = empty; await view.updateComplete;
  for (const locale of ["de", "en-XA", "ar-XB", "en"]) {
    await language(view, locale);
    const shells = root.querySelectorAll(".shell-output");
    expect(shells[0]?.textContent).toBe(`$ false\n\n${messages.t("shellNoOutput")}\n${messages.t("shellFailed")}`);
    expect(shells[1]?.textContent).toBe("$ false\n\nBash command failed");
  }
});

it("localizes retained generated command feedback while identical extension text stays raw", async () => {
  const auth = "Authentication for raw/<model> was removed. Use /model to select another model.";
  const naming = "Session created, but naming failed: <img src=x> diagnostic";
  const view = new ChatView();
  view.behaviors = { ...view.behaviors, followTail: false, rememberPosition: false };
  let lines: ChatLine[] = [];
  for (const event of [
    { type: "command.output", level: "error", message: auth, presentation: { kind: "modelAuthRemoved", provider: "raw", model: "<model>" } },
    { type: "command.output", level: "error", message: naming, presentation: { kind: "sessionNamingFailed", detail: "<img src=x> diagnostic" } },
    { type: "command.output", level: "error", message: auth },
    { type: "command.output", level: "error", message: naming },
  ] as const) lines = required(applyTranscriptEvent(lines, event));
  view.messages = lines;
  document.body.append(view); await view.updateComplete;
  const root = required(view.shadowRoot);
  for (const group of root.querySelectorAll<HTMLDetailsElement>(".event-group")) {
    group.open = true; group.dispatchEvent(new Event("toggle"));
  }
  await view.updateComplete;
  const generated = Array.from(root.querySelectorAll(".generated-text"));
  expect(generated).toHaveLength(2);
  for (const locale of ["en", "en-XA", "ar-XB"]) {
    await language(view, locale);
    expect(Array.from(root.querySelectorAll(".generated-text"))).toEqual(generated);
    expect(generated[0]?.textContent).toBe(messages.t("modelAuthRemoved", { provider: "raw", model: "<model>" }));
    expect(generated[1]?.textContent).toBe(messages.t("sessionNamingFailed", { detail: "<img src=x> diagnostic" }));
    expect(root.querySelector("img, model")).toBeNull();
    const raw = Array.from(root.querySelectorAll("formatted-text")).map((node) => "text" in node ? node.text : undefined);
    expect(raw).toContain(auth); expect(raw).toContain(naming);
    expect(view.messages).toBe(lines);
    expect(lines[0]?.parts[0]).toMatchObject({ text: auth });
    expect(lines[1]?.parts[0]).toMatchObject({ text: naming });
  }
});

it("renders retained HTTP command results as safe live text while raw command text remains unchanged", async () => {
  const presentation = { kind: "commandResult", feedback: { code: "reloadFailed", detail: "<img src=x> diagnostic" } } as const;
  const raw = "Reload failed: <img src=x> diagnostic";
  const lines: ChatLine[] = [
    { role: "system", parts: [{ type: "text", text: raw, presentation }] },
    { role: "system", parts: [{ type: "text", text: raw }] },
  ];
  const view = new ChatView();
  view.behaviors = { ...view.behaviors, followTail: false, rememberPosition: false };
  view.messages = lines;
  document.body.append(view); await view.updateComplete;
  const root = required(view.shadowRoot);
  for (const group of root.querySelectorAll<HTMLDetailsElement>(".event-group")) {
    group.open = true; group.dispatchEvent(new Event("toggle"));
  }
  await view.updateComplete;
  const generated = required(root.querySelector(".generated-text"));
  for (const locale of ["en", "en-XA", "ar-XB"]) {
    await language(view, locale);
    expect(root.querySelector(".generated-text")).toBe(generated);
    expect(generated.textContent).toBe(localizedCommandResult(presentation));
    expect(root.querySelector("img")).toBeNull();
    expect(Array.from(root.querySelectorAll("formatted-text")).some((node) => "text" in node && node.text === raw)).toBe(true);
    expect(view.messages).toBe(lines);
  }
});

it("uses ICU counts and regional lists for every group-summary kind and role", async () => {
  await localization.setPreferences({ language: "ar-XB", formatLocale: "ar-EG" });
  const roles = ["user", "assistant", "tool", "system", "bash", "skill"] as const;
  const lines: ChatLine[] = roles.map((role) => ({ role, parts: [] }));
  const result = summarizeChatGroup(lines, localizedChatGroupSummary);
  for (const role of roles) expect(result).toContain(messages.t("roleCount", { role, count: 1 }));
  for (const [source, kind] of [["compaction", "compaction"], ["branch_summary", "branch"]] as const) {
    const result = summarizeChatGroup([{ role: "system", parts: [], source }, { role: "system", parts: [], source }], localizedChatGroupSummary);
    expect(result).toBe(messages.t("groupSummary", { kind, count: 2, roles: "" }));
  }
});

it("keeps image descriptions live in an already-open gallery and source disclosures", async () => {
  const view = new ChatView();
  view.messages = ["one", "two"].map((entryId) => ({ role: "tool", entryId, parts: [{ type: "image", mimeType: "image/png", data: "QUJD" }] }));
  document.body.append(view); await view.updateComplete;
  const root = required(view.shadowRoot);
  const images = Array.from(root.querySelectorAll<TranscriptImage>("pi-web-transcript-image"));
  await Promise.all(images.map((image) => settleImage(image)));
  const presentation = imagePresentation(required(images[1]));
  required(presentation.shadowRoot?.querySelector<HTMLButtonElement>(".image-button")).click();
  const gallery = required(root.querySelector<ImageGalleryDialog>("pi-web-image-gallery-dialog"));
  await gallery.updateComplete;
  const sources = required(root.querySelector<HTMLDetailsElement>(".image-output-sources"));
  sources.open = true; sources.dispatchEvent(new Event("toggle")); await view.updateComplete;
  const source = required(sources.querySelector(".image-output-source"));
  const fullImage = required(gallery.shadowRoot?.querySelector<HTMLImageElement>(".image-zoom-full"));
  for (const locale of ["en-XA", "ar-XB", "en"]) {
    await language(view, locale); await gallery.updateComplete;
    await Promise.all(images.map((image) => image.updateComplete)); await presentation.updateComplete;
    expect(root.querySelector("pi-web-transcript-image")).toBe(images[0]);
    expect(gallery.shadowRoot?.querySelector(".image-zoom-full")).toBe(fullImage);
    const description = messages.t("toolImage", { name: "", named: "no", index: 2, total: 2 });
    expect(fullImage.alt).toBe(description);
    expect(presentation.shadowRoot?.querySelector(".image-button")?.getAttribute("aria-label")).toContain(description);
    expect(sources.open).toBe(true);
    expect(sources.querySelector(".image-output-source")).toBe(source);
    expect(sources.querySelector("summary")?.textContent).toBe(messages.t("sources", { count: 2 }));
    expect(source.getAttribute("aria-label")).toBe(messages.t("output", { index: 1 }));
    expect(source.querySelector(".label")?.textContent).toBe(messages.t("sourceHeader", { name: "", named: "no", index: 1 }));
  }
});

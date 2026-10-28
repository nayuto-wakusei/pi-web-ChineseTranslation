// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localization } from "../localization/browser";
import { SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH } from "../../../shared/apiTypes";
import type { SessionTreeNavigateResult, SessionTreeNodeKind } from "../api";
import { SessionTreeNavigator } from "./SessionTreeNavigator";
import { ModalSurface } from "./ModalSurface";
import definitions from "./sessionTree.messages";
import summaryDefinitions from "../sessionTreeSummary.messages";
import { projectSessionTree } from "../../../server/sessions/sessionTreeProjection";
import { deepActiveElement, settleRenderedDialog } from "./modalSurfaceTestSupport";

let releaseCatalog: (() => void) | undefined;
let releaseSummaryCatalog: (() => void) | undefined;
beforeEach(async () => {
  Element.prototype.scrollIntoView = vi.fn();
  await localization.setPreferences({ language: "en", formatLocale: "en-US", timeZone: "UTC" });
  releaseCatalog = localization.registerCatalog({
    id: "tree-test-de", namespace: "core.sessionTree", locale: "de", load: () => Promise.resolve({
      ...Object.fromEntries(Object.entries(definitions).map(([key, value]) => [key, value.message])),
      title: "Sitzungsverlauf auswählen", kind_user: "Benutzer", required: "Bitte Fokus eingeben.",
      tooLong: "Höchstens {max, number} Zeichen.", navigationFailed: "Navigation fehlgeschlagen: {error}",
      forkFailed: "Abzweigung fehlgeschlagen: {error}", abortFailed: "Abbruch fehlgeschlagen: {error}",
      navigationUnavailable: "Navigation nicht verfügbar.", forkUnavailable: "Abzweigung nicht verfügbar.",
      abortUnavailable: "Abbruch nicht verfügbar.", summaryCancelled: "Zusammenfassung abgebrochen.",
      navigationCancelled: "Navigation abgebrochen.", forkCancelled: "Abzweigung abgebrochen.",
      aborting: "Zusammenfassung wird abgebrochen…", summarizing: "Zusammenfassung läuft…",
    }),
  });
  releaseSummaryCatalog = localization.registerCatalog({
    id: "tree-summary-test-de", namespace: "core.sessionTreeSummary", locale: "de", load: () => Promise.resolve({
      ...Object.fromEntries(Object.entries(summaryDefinitions).map(([key, value]) => [key, value.message])),
      image: "[Bild]",
      toolResult: "{error, select, yes {Werkzeugfehler} other {Werkzeugergebnis}}{hasName, select, yes { ({name})} other {}}{hasContent, select, yes {: {content}} other {}}",
    }),
  });
  await localization.ready;
});
afterEach(async () => {
  document.body.replaceChildren();
  localStorage.clear();
  releaseCatalog?.();
  releaseSummaryCatalog?.();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  vi.restoreAllMocks();
});

async function locale(element: SessionTreeNavigator, language = "de", formatLocale = "de-DE") {
  await localization.setPreferences({ language, formatLocale, timeZone: "Europe/Berlin", hourCycle: "h23" });
  await settleRenderedDialog(element);
}
async function mount() {
  const element = new SessionTreeNavigator();
  element.tree = {
    nodes: [
      { id: "root", parentId: null, kind: "user", summary: "User text العربية", label: "My label", timestamp: "2026-01-02T15:04:00Z" },
      { id: "child", parentId: "root", kind: "assistant", summary: "Answer", timestamp: "invalid timestamp" },
    ], activeLeafId: "root", activePathIds: ["root"],
  };
  document.body.append(element);
  await settleRenderedDialog(element);
  return element;
}
function query<T extends Element>(element: SessionTreeNavigator, selector: string, type: new(...args: never[]) => T): T {
  const found = element.renderRoot.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Missing ${selector}`);
  return found;
}
async function action(element: SessionTreeNavigator) {
  query(element, "footer .primary", HTMLButtonElement).click();
  await settleRenderedDialog(element);
}
async function radio(element: SessionTreeNavigator, value: string) {
  query(element, `input[value='${value}']`, HTMLInputElement).click();
  await settleRenderedDialog(element);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("session tree live localization", () => {
  it("renders projected summary provenance live in the tree and selected-entry step without translating or interpreting raw text", async () => {
    const raw = "Tool error [image] <b>العربية</b>";
    const element = new SessionTreeNavigator();
    element.tree = projectSessionTree([{
      entry: { id: "tool", parentId: null, type: "message", message: { role: "toolResult", toolName: "read", isError: true, content: [
        { type: "text", text: raw }, { type: "image", data: "private" },
      ] } }, children: [],
    }], "tool");
    document.body.append(element);
    await settleRenderedDialog(element);
    const selected = query(element, "[data-tree-node-id='tool']", HTMLElement);
    expect(query(element, ".summary", HTMLElement).textContent).toBe(`Tool error (read): ${raw} [image]`);
    await locale(element);
    expect(query(element, ".summary", HTMLElement).textContent).toBe(`Werkzeugfehler (read): ${raw} [Bild]`);
    expect(element.renderRoot.querySelector(".summary b")).toBeNull();
    expect(query(element, "[aria-selected='true']", HTMLElement)).toBe(selected);
    expect(deepActiveElement()).toBe(selected);
    await action(element);
    expect(query(element, ".selected-entry strong", HTMLElement).textContent).toBe(`Werkzeugfehler (read): ${raw} [Bild]`);
    for (const language of ["en-XA", "ar-XB"]) {
      await locale(element, language);
      const summary = query(element, ".selected-entry strong", HTMLElement);
      expect(summary.textContent).toContain(raw);
      expect(summary.textContent).not.toContain("Werkzeugfehler");
      expect(summary.textContent).not.toBe(`Tool error (read): ${raw} [image]`);
      expect(summary.getAttribute("dir")).toBe("auto");
      expect(query(element, "input[value='continue']", HTMLInputElement).checked).toBe(true);
    }
  });

  it("updates accessible labels, kind badges and native timestamps without changing selection, folds or focus", async () => {
    const element = await mount();
    const selected = query(element, "[data-tree-node-id='root']", HTMLElement);
    query(element, ".disclosure", HTMLElement).click();
    await settleRenderedDialog(element);
    await locale(element);
    expect(query(element, "h1", HTMLElement).textContent).toBe("Sitzungsverlauf auswählen");
    expect(query(element, "modal-surface", ModalSurface).label).toBe("Sitzungsverlauf auswählen");
    expect(query(element, ".kind", HTMLElement).textContent).toBe("Benutzer");
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.getAttribute("aria-expanded")).toBe("false");
    expect(deepActiveElement()).toBe(selected);
    const time = query(element, "time", HTMLTimeElement);
    expect(time.dateTime).toBe("2026-01-02T15:04:00Z");
    expect(time.textContent).toBe(new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin", hourCycle: "h23" }).format(new Date(time.dateTime)));
    expect(query(element, ".summary", HTMLElement).textContent).toBe("User text العربية");
    expect(query(element, ".label", HTMLElement).getAttribute("dir")).toBe("auto");
    query(element, ".disclosure", HTMLElement).click();
    await settleRenderedDialog(element);
    expect([...element.renderRoot.querySelectorAll("time")].at(-1)?.textContent).toBe("invalid timestamp");
  });

  it("mirrors horizontal tree keyboard navigation in RTL without resetting selection", async () => {
    const element = await mount();
    await locale(element, "ar-XB", "ar-EG");
    const root = query(element, "[data-tree-node-id='root']", HTMLElement);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await settleRenderedDialog(element);
    expect(root.getAttribute("aria-expanded")).toBe("false");
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await settleRenderedDialog(element);
    expect(root.getAttribute("aria-expanded")).toBe("true");
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await settleRenderedDialog(element);
    expect(query(element, "[aria-selected='true']", HTMLElement).dataset["treeNodeId"]).toBe("child");
  });

  it("preserves the custom draft, selection and focus through long/RTL pseudo locales and retranslates validation", async () => {
    const element = await mount();
    await action(element);
    await radio(element, "custom");
    const textarea = query(element, "textarea", HTMLTextAreaElement);
    expect(element.renderRoot.querySelector(".validation-error")?.textContent).toContain("Enter custom summary");
    await locale(element);
    expect(element.renderRoot.querySelector(".validation-error")?.textContent).toBe("Bitte Fokus eingeben.");
    textarea.value = "  draft العربية  ";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settleRenderedDialog(element);
    textarea.setSelectionRange(3, 7);
    for (const language of ["en-XA", "ar-XB"]) {
      await locale(element, language, "ar-EG");
      expect(query(element, "textarea", HTMLTextAreaElement)).toBe(textarea);
      expect(textarea.value).toBe("  draft العربية  ");
      expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 7]);
      expect(deepActiveElement()).toBe(textarea);
      expect(query(element, "input[value='custom']", HTMLInputElement).checked).toBe(true);
      expect(query(element, ".selected-entry strong", HTMLElement).textContent).toBe("User text العربية");
      expect(query(element, "h1", HTMLElement).textContent).not.toBe("Navigate session tree");
    }
    textarea.value = "x".repeat(SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH + 1);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await locale(element);
    expect(element.renderRoot.querySelector(".validation-error")?.textContent).toBe(`Höchstens ${localization.number(SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH)} Zeichen.`);
  });

  it.each(["continue", "fork", "abort"] as const)("retranslates %s failures with original diagnostic provenance", async (operation) => {
    const element = await mount();
    const failure = new Error("BACKEND /tree diagnostic العربية");
    const pending = deferred<SessionTreeNavigateResult>();
    element.onNavigate = () => operation === "abort" ? pending.promise : Promise.reject(failure);
    element.onFork = () => Promise.reject(failure);
    element.onAbort = () => Promise.reject(failure);
    await action(element);
    if (operation === "fork") await radio(element, "fork");
    if (operation === "abort") await radio(element, "default");
    await action(element);
    if (operation === "abort") {
      query(element, "footer .danger", HTMLButtonElement).click();
      await settleRenderedDialog(element);
    }
    expect(element.renderRoot.querySelector(".dialog-error")?.textContent).toContain(failure.message);
    await locale(element);
    const prefix = operation === "fork" ? "Abzweigung" : operation === "abort" ? "Abbruch" : "Navigation";
    expect(element.renderRoot.querySelector(".dialog-error")?.textContent).toBe(`${prefix} fehlgeschlagen: ${failure.message}`);
    pending.resolve({ cancelled: true });
    await settleRenderedDialog(element);
  });

  it("keeps pending navigation and abort actions intact and retranslates cancellation status", async () => {
    const element = await mount();
    const pending = deferred<SessionTreeNavigateResult>();
    const abort = deferred<undefined>();
    element.onNavigate = vi.fn(() => pending.promise);
    element.onAbort = vi.fn(() => abort.promise);
    await action(element);
    await radio(element, "default");
    await action(element);
    await locale(element);
    expect(query(element, "footer .primary", HTMLButtonElement).disabled).toBe(true);
    expect(query(element, "footer .primary", HTMLButtonElement).textContent.trim()).toBe("Zusammenfassung läuft…");
    expect(element.onNavigate).toHaveBeenCalledExactlyOnceWith("root", { mode: "default" });
    query(element, "footer .danger", HTMLButtonElement).click();
    await settleRenderedDialog(element);
    await locale(element, "en", "en-US");
    expect(query(element, "footer .danger", HTMLButtonElement).disabled).toBe(true);
    expect(element.renderRoot.querySelector(".dialog-status")?.textContent).toBe("Cancelling summarization…");
    await locale(element);
    expect(element.renderRoot.querySelector(".dialog-status")?.textContent).toBe("Zusammenfassung wird abgebrochen…");
    expect(element.onAbort).toHaveBeenCalledOnce();
    abort.resolve(undefined);
    pending.resolve({ cancelled: true, aborted: true });
    await settleRenderedDialog(element);
    expect(element.renderRoot.querySelector(".dialog-status")?.textContent).toBe("Zusammenfassung abgebrochen.");
    await locale(element, "en", "en-US");
    expect(element.renderRoot.querySelector(".dialog-status")?.textContent).toContain("Summarization cancelled.");
    expect(query(element, "[aria-selected='true']", HTMLElement).dataset["treeNodeId"]).toBe("root");
  });

  it.each(["continue", "fork", "abort"] as const)("retranslates locally generated %s unavailable errors", async (operation) => {
    const element = await mount();
    const pending = deferred<SessionTreeNavigateResult>();
    if (operation === "abort") element.onNavigate = () => pending.promise;
    await action(element);
    if (operation === "fork") await radio(element, "fork");
    if (operation === "abort") await radio(element, "default");
    await action(element);
    if (operation === "abort") query(element, "footer .danger", HTMLButtonElement).click();
    await locale(element);
    expect(element.renderRoot.querySelector(".dialog-error")?.textContent).toBe(operation === "fork" ? "Abzweigung nicht verfügbar." : operation === "abort" ? "Abbruch nicht verfügbar." : "Navigation nicht verfügbar.");
    pending.resolve({ cancelled: true });
    await settleRenderedDialog(element);
  });

  it.each(["continue", "fork"] as const)("keeps a pending %s and its cancellation status live across locales", async (operation) => {
    const element = await mount();
    const pending = deferred<{ cancelled: true }>();
    const submit = vi.fn(() => pending.promise);
    element.onNavigate = submit;
    element.onFork = submit;
    await action(element);
    if (operation === "fork") await radio(element, "fork");
    await action(element);
    await locale(element, "en-XA");
    expect(query(element, "footer .primary", HTMLButtonElement).disabled).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
    pending.resolve({ cancelled: true });
    await settleRenderedDialog(element);
    await locale(element);
    expect(element.renderRoot.querySelector(".dialog-status")?.textContent).toBe(operation === "fork" ? "Abzweigung abgebrochen." : "Navigation abgebrochen.");
    await locale(element, "en", "en-US");
    expect(element.renderRoot.querySelector(".dialog-status")?.textContent).toContain(operation === "fork" ? "Fork cancelled." : "Navigation cancelled.");
    expect(submit).toHaveBeenCalledOnce();
  });

  it("localizes every kind label rather than exposing transport codes", async () => {
    const element = await mount();
    const kinds: SessionTreeNodeKind[] = ["user", "assistant", "tool-result", "bash", "custom-message", "compaction", "branch-summary", "model-change", "thinking-level-change", "session-info", "label", "custom", "other"];
    element.tree = { nodes: kinds.map((kind) => ({ id: kind, parentId: null, kind, summary: `Raw ${kind}` })), activeLeafId: null, activePathIds: [] };
    await settleRenderedDialog(element);
    const original = [...element.renderRoot.querySelectorAll(".kind")].map((badge) => badge.textContent);
    await locale(element, "en-XA");
    expect([...element.renderRoot.querySelectorAll(".kind")].every((badge, index) => badge.textContent !== original[index])).toBe(true);
    expect([...element.renderRoot.querySelectorAll(".summary")].map((summary) => summary.textContent)).toEqual(kinds.map((kind) => `Raw ${kind}`));
  });
});

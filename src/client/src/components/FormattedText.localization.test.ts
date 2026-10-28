// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { localization } from "../localization/browser";
import { formattedTextMessages as messages } from "../formattedTextMessages";
import { writeClipboardText } from "../clipboard";
import { createContentRenderingService } from "../formatting/contentRendering";
import { DEFAULT_CODE_BLOCK_POLICY } from "../formatting/codeBlockPolicy";
import { settleDeferredContent, useDeferredContent } from "../formatting/deferredContent.testSupport";
import { FormattedText } from "./FormattedText";

vi.mock("../clipboard", () => ({ writeClipboardText: vi.fn().mockResolvedValue(true) }));
useDeferredContent();
let release: (() => void) | undefined;
afterEach(async () => {
  document.body.replaceChildren();
  release?.();
  release = undefined;
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected Markdown control");
  return value;
}
async function settle(view: FormattedText): Promise<void> {
  await settleDeferredContent(view);
  await settleDeferredContent(view);
}

it.each([false, true])("keeps source, tables, focus and copy feedback live with enhancement=%s", async (enhanced) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  release = localization.registerCatalog({ id: "markdown-test", namespace: "core.formattedText", locale: "de", load: () => Promise.resolve({
    copy: "Kopieren '<img>'", copied: "Kopiert '<b>'", failed: "Fehlgeschlagen '<script>'", controls: "Quelltextaktionen", table: "Tabelle",
  }) });
  const view = new FormattedText();
  view.text = 'Raw العربية <img>\n\n```text\n<code> & العربية\n```\n\n| Raw | العربية |\n| --- | --- |\n| Value | <b> |';
  if (enhanced) view.contentRendering = createContentRenderingService(() => []);
  document.body.append(view);
  await settle(view);
  const root = required(view.shadowRoot);
  const copy = required(root.querySelector<HTMLButtonElement>(".code-copy-button"));
  const source = required(root.querySelector("pre code"));
  const table = required(root.querySelector(".table-scroll"));
  copy.focus();
  copy.click();
  await settle(view);
  for (const language of ["de", "en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "ar-EG" });
    await view.updateComplete;
    expect(root.querySelector(".code-copy-button")).toBe(copy);
    expect(root.activeElement).toBe(copy);
    expect(root.querySelector("pre code")).toBe(source);
    expect(source.textContent).toBe("<code> & العربية\n");
    expect(root.querySelector(".table-scroll")).toBe(table);
    expect(table.getAttribute("aria-label")).toBe(messages.t("table"));
    expect(root.querySelector(".code-block-header")?.getAttribute("aria-label")).toBe(messages.t("controls"));
    expect(copy.getAttribute("aria-label")).toBe(messages.t("copied"));
    expect(copy.title).toBe(messages.t("copied"));
    expect(root.querySelector("img, script, b")).toBeNull();
  }
  expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith("<code> & العربية\n");
  await vi.advanceTimersByTimeAsync(1200);
  expect(copy.title).toBe(messages.t("copy"));
  vi.mocked(writeClipboardText).mockResolvedValueOnce(false);
  copy.click();
  await settle(view);
  await localization.setPreferences({ language: "de", formatLocale: "de" });
  await view.updateComplete;
  expect(copy.title).toBe("Fehlgeschlagen <script>");
  expect(copy.querySelector("span")?.textContent).toBe("⧉");
  view.remove();
  await localization.setPreferences({ language: "ar-XB", formatLocale: "ar-EG" });
  document.body.append(view);
  await settle(view);
  expect(root.querySelector(".code-copy-button")).toBe(copy);
  expect(copy.title).toBe(messages.t("failed"));
  await vi.advanceTimersByTimeAsync(1200);
  expect(copy.title).toBe(messages.t("copy"));

  // New source mounted after the language switch receives localized labels too.
  view.text = "```text\nNew raw source\n```";
  await settle(view);
  expect(root.querySelector(".code-copy-button")?.getAttribute("aria-label")).toBe(messages.t("copy"));
  expect(root.querySelector("pre code")?.textContent).toBe("New raw source\n");
});

it("localizes copy-free toolbar labels without introducing controls", async () => {
  const view = new FormattedText();
  view.text = "```text\nRaw source\n```";
  view.codeBlocks = { ...DEFAULT_CODE_BLOCK_POLICY, copy: false };
  document.body.append(view);
  await settle(view);
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  await view.updateComplete;
  expect(view.renderRoot.querySelector(".code-block-header")?.getAttribute("aria-label")).toBe(messages.t("controls"));
  expect(view.renderRoot.querySelector("button")).toBeNull();
});

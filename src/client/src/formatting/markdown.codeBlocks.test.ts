// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { marked } from "marked";
import { toSafeMarkdownHtml } from "./markdown";
import { t } from "../i18n";
import { DEFAULT_CODE_BLOCK_POLICY, PLAIN_CODE_BLOCK_POLICY } from "./codeBlockPolicy";

afterEach(() => { vi.restoreAllMocks(); });

describe("plain Markdown code blocks", () => {
  it.each([
    ["```text\nfirst\n  second\n```", "first\n  second\n"],
    ["~~~text\nfirst\n  second\n~~~", "first\n  second\n"],
    ["> ```text\n> first\n>   second\n> ```", "first\n  second\n"],
    ["    first\n      second", "first\n  second\n"],
    ["```text\nunclosed", "unclosed\n"],
  ])("keeps block content as literal text without pre/code markup: %s", (text, expected) => {
    const root = document.createElement("div");
    root.innerHTML = toSafeMarkdownHtml(text, undefined, undefined, true, PLAIN_CODE_BLOCK_POLICY);
    expect(root.querySelector(".plain-code-block")?.textContent).toBe(expected);
    expect(root.querySelector("pre, code")).toBeNull();
  });

  it("keeps code inert while preserving surrounding Markdown and inline code", () => {
    const root = document.createElement("div");
    root.innerHTML = toSafeMarkdownHtml('## Heading\n\n**Prose** with `inline`.\n\n```html\n<img src="x" onerror="bad()">\n**literal** & text\n```', undefined, undefined, true, PLAIN_CODE_BLOCK_POLICY);
    expect(root.querySelector("h2")?.textContent).toBe("Heading");
    expect(root.querySelector("strong")?.textContent).toBe("Prose");
    expect(root.querySelector("code")?.textContent).toBe("inline");
    expect(root.querySelector(".plain-code-block")?.textContent).toBe('<img src="x" onerror="bad()">\n**literal** & text\n');
    expect(root.querySelector("img, script, pre")).toBeNull();
  });

  it("does not reuse enhanced HTML for plain blocks or plain HTML when rendering is enabled", () => {
    const text = "```text\ncode-block cache isolation\n```";
    const rendered = toSafeMarkdownHtml(text);
    const plain = toSafeMarkdownHtml(text, undefined, undefined, true, PLAIN_CODE_BLOCK_POLICY);
    expect(rendered).toContain("<pre><code");
    expect(plain).not.toContain("<pre>");
    expect(plain).toContain('class="plain-code-block"');
    expect(toSafeMarkdownHtml(text)).toBe(rendered);
    expect(toSafeMarkdownHtml(text, undefined, undefined, true, PLAIN_CODE_BLOCK_POLICY)).toBe(plain);
  });

  it.each(["plain", "code"] as const)("generates optional copy controls with inert %s source before mounting", (presentation) => {
    const text = '```html\n<img src="x" onerror="bad()"> & literal\n```';
    const policy = { ...PLAIN_CODE_BLOCK_POLICY, presentation };
    const root = document.createElement("div");
    root.innerHTML = toSafeMarkdownHtml(text, undefined, undefined, true, policy);
    expect(root.querySelector("button")).toBeNull();
    expect(root.querySelectorAll(".code-block-frame")).toHaveLength(presentation === "code" ? 1 : 0);
    root.innerHTML = toSafeMarkdownHtml(text, undefined, undefined, true, { ...policy, copy: true });
    expect(root.querySelectorAll(".code-block-wrapper")).toHaveLength(1);
    expect(root.querySelectorAll(`button[aria-label="${t("images.code.copy", "Copy code block")}"]`)).toHaveLength(1);
    const copy = root.querySelector(".code-copy-button");
    expect(copy?.parentElement?.classList.contains("code-block-header")).toBe(true);
    expect(copy?.parentElement?.nextElementSibling?.tagName).toBe(presentation === "code" ? "PRE" : "DIV");
    expect(copy?.parentElement?.querySelector(".code-block-label")?.textContent).toBe("html");
    expect(root.querySelector(presentation === "code" ? "pre code" : ".plain-code-block")?.textContent).toBe('<img src="x" onerror="bad()"> & literal\n');
    expect(root.querySelector("img, script")).toBeNull();
    expect(toSafeMarkdownHtml(text, undefined, undefined, true, policy)).not.toContain("code-copy-button");
  });

  it.each([
    ["```typescript\nsource\n```", "typescript"],
    ['```bash title="demo"\nsource\n```', "bash"],
    ["```\nsource\n```", null],
    ["    source", null],
    ["```<img\nsource\n```", "<img"],
  ])("labels the frame with only an inert fence language, or nothing: %s", (text, language) => {
    const root = document.createElement("div");
    root.innerHTML = toSafeMarkdownHtml(text);
    expect(root.querySelector(".code-block-frame > .code-block-header")).not.toBeNull();
    expect(root.querySelector(".code-block-label")?.textContent ?? null).toBe(language);
    expect(root.querySelectorAll(".code-block-copy")).toHaveLength(1);
    expect(root.querySelector("img, script, select")).toBeNull();
  });

  it("retains the native frame and language label when copying is disabled", () => {
    const root = document.createElement("div");
    root.innerHTML = toSafeMarkdownHtml("```typescript\nsource\n```", undefined, undefined, true, { ...DEFAULT_CODE_BLOCK_POLICY, copy: false });
    expect(root.querySelector(".code-block-frame .code-block-label")?.textContent).toBe("typescript");
    expect(root.querySelector("button")).toBeNull();
    expect(root.querySelector("pre code")?.textContent).toBe("source\n");
  });

  it("reuses HTML across overflow and preview choices but not presentation or copy choices", () => {
    const text = "```text\nindependent block policy cache\n```";
    const plain = toSafeMarkdownHtml(text, undefined, undefined, true, PLAIN_CODE_BLOCK_POLICY);
    const parse = vi.spyOn(marked, "parse");
    expect(toSafeMarkdownHtml(text, undefined, undefined, true, { ...PLAIN_CODE_BLOCK_POLICY, overflow: "scroll", previews: true })).toBe(plain);
    expect(parse).not.toHaveBeenCalled();
    expect(toSafeMarkdownHtml(text, undefined, undefined, true, { ...PLAIN_CODE_BLOCK_POLICY, presentation: "code" })).toContain("<pre><code");
    expect(toSafeMarkdownHtml(text, undefined, undefined, true, { ...DEFAULT_CODE_BLOCK_POLICY, copy: false })).not.toContain("code-copy-button");
    expect(toSafeMarkdownHtml(text, undefined, undefined, true, { ...PLAIN_CODE_BLOCK_POLICY, copy: true })).toContain("code-copy-button");
    expect(parse).toHaveBeenCalledTimes(2);
  });
});

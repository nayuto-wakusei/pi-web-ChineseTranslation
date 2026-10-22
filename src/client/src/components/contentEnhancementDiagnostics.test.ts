// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { ContentRenderingBoundary } from "./ContentRenderingBoundary";
import { ContentRendererHost } from "./ContentRendererHost";
import { FormattedText } from "./FormattedText";
import * as markdown from "../formatting/markdown";
import { settleDeferredContent, useDeferredContent } from "../formatting/deferredContent.testSupport";

useDeferredContent();

it("logs only fixed failure categories while secret-bearing enhancement errors retain readable source", async () => {
  const secret = "private-management-source-secret";
  const error = new Error(secret);
  error.name = `untrusted-${secret}`;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const boundary = new ContentRenderingBoundary();
  boundary.source = secret;
  boundary.renderContent = () => { throw error; };
  document.body.append(boundary);
  await settleDeferredContent(boundary);
  expect(boundary.textContent).toContain(secret);

  const formatting = vi.spyOn(markdown, "toSafeMarkdownHtml").mockImplementation(() => { throw error; });
  const raw = new FormattedText();
  raw.text = secret;
  document.body.append(raw);
  await settleDeferredContent(raw);
  expect(raw.renderRoot.querySelector(".pending-source")?.textContent).toBe(secret);
  formatting.mockRestore();

  const enhanced = new FormattedText();
  enhanced.text = secret;
  enhanced.contentRendering = { renderMarkdown: () => { throw error; } };
  document.body.append(enhanced);
  await settleDeferredContent(enhanced);
  expect(enhanced.renderRoot.querySelector(".enhanced-content")?.textContent).toContain(secret);

  const renderer = new ContentRendererHost();
  renderer.text = secret;
  renderer.choices = [{ id: "test:renderer", label: "Test", renderer: {
    id: "renderer", renderMode: "automatic", render: () => { throw error; },
  } }];
  document.body.append(renderer);
  await settleDeferredContent(renderer);
  expect(renderer.renderRoot.querySelector("pre code")?.textContent).toBe(secret);
  expect(renderer.renderRoot.querySelector("p[role=status]")?.textContent).toContain("Preview failed");
  expect(warn.mock.calls).toEqual([
    ["Markdown content enhancement failed; source remains available"],
    ["Chat Markdown formatting failed; source remains available"],
    ["Chat content enhancement failed; Markdown remains available"],
    ["Content renderer failed; source remains available"],
  ]);
  expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
});

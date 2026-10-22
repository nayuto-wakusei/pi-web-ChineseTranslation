// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { html } from "lit";
import { FormattedText } from "./FormattedText";
import { settleDeferredContent, useDeferredContent } from "../formatting/deferredContent.testSupport";

useDeferredContent();

it("keeps search highlights after deferred Markdown and later streamed text", async () => {
  const view = new FormattedText();
  view.text = "Search **needle**";
  view.highlight = "needle";
  document.body.append(view);
  await settleDeferredContent(view);
  expect(view.renderRoot.querySelectorAll("mark[data-search-highlight]")).toHaveLength(1);
  view.text += " then NEEDLE";
  await settleDeferredContent(view);
  expect(view.renderRoot.querySelectorAll("mark[data-search-highlight]")).toHaveLength(2);
  view.highlight = "then";
  await view.updateComplete;
  expect(view.renderRoot.querySelector("mark")?.textContent).toBe("then");
});

it("refreshes renderer eligibility on the fork revision without changing text", async () => {
  const view = new FormattedText();
  const renderMarkdown = vi.fn(() => html`<b>first renderer</b>`);
  view.text = "source";
  view.contentRendering = { renderMarkdown };
  document.body.append(view);
  await settleDeferredContent(view);
  expect(renderMarkdown).toHaveBeenCalledOnce();
  renderMarkdown.mockImplementation(() => html`<b>next renderer</b>`);
  view.contentRendererVersion += 1;
  await settleDeferredContent(view);
  expect(renderMarkdown).toHaveBeenCalledTimes(2);
  expect(view.renderRoot.querySelector("b")?.textContent).toBe("next renderer");
});

it("drops previous machine preview DOM immediately even when the source is identical", async () => {
  const view = new FormattedText();
  view.text = "same source";
  view.contentRendering = { renderMarkdown: () => html`<b>old machine preview</b>` };
  document.body.append(view);
  await settleDeferredContent(view);
  expect(view.renderRoot.querySelector("b")).not.toBeNull();
  view.machineId = "another-machine";
  view.intentKey = "another-session";
  await view.updateComplete;
  expect(view.renderRoot.querySelector("b")).toBeNull();
  expect(view.renderRoot.textContent).toContain("same source");
});

it("does not replace Lit-owned pending source nodes while a search is active", async () => {
  const view = new FormattedText();
  view.text = "first needle";
  view.highlight = "needle";
  document.body.append(view);
  await view.updateComplete;
  expect(view.renderRoot.querySelector(".pending-source")?.textContent).toBe("first needle");
  view.text = "second needle";
  await view.updateComplete;
  expect(view.renderRoot.querySelector(".pending-source")?.textContent).toBe("second needle");
  await settleDeferredContent(view);
  expect(view.renderRoot.querySelector("mark")?.textContent).toBe("needle");
});

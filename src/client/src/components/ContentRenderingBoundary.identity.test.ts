// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { html } from "lit";
import { ContentRenderingBoundary } from "./ContentRenderingBoundary";
import { settleDeferredContent, useDeferredContent } from "../formatting/deferredContent.testSupport";

useDeferredContent();

it("releases the previous machine or intent DOM before enhancing identical replacement source", async () => {
  const boundary = new ContentRenderingBoundary();
  boundary.source = "same source";
  boundary.identity = "machine-a/session-a";
  boundary.renderContent = () => html`<b>machine A output</b>`;
  document.body.append(boundary);
  await settleDeferredContent(boundary);
  expect(boundary.querySelector("b")?.textContent).toBe("machine A output");

  boundary.identity = "machine-b/session-a";
  boundary.renderContent = () => html`<b>machine B output</b>`;
  await boundary.updateComplete;
  expect(boundary.querySelector("b")).toBeNull();
  expect(boundary.textContent).toContain("same source");
  await settleDeferredContent(boundary);
  expect(boundary.querySelector("b")?.textContent).toBe("machine B output");

  boundary.identity = "machine-b/session-b";
  await boundary.updateComplete;
  expect(boundary.querySelector("b")).toBeNull();
});

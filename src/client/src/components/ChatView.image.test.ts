import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import type { ChatLine } from "../chatTypes";
import { ChatView, chatMessageMetadataLabel } from "./ChatView";
import { isTemplateResult, templateStrings, templateValues, templateValuesAfterMarker } from "../templateInspection.testSupport";

describe("ChatView image rendering", () => {
  // Direct handler extraction keeps this node-environment test focused on the
  // late image-load scroll wiring without introducing a component-wide DOM shim.
  it("renders native image data and re-pins late loads only while already pinned", () => {
    const view = new ChatView();
    let scrollCalls = 0;
    if (!Reflect.set(view, "scrollToBottom", () => { scrollCalls += 1; })) throw new Error("Could not observe ChatView.scrollToBottom");
    const rendered = renderPart(view, { type: "image", mimeType: "image/png", data: "QUJD" });
    const onLoad = templateEventHandler(rendered, "@load=");

    expect(templateStaticMarkup(rendered)).toContain("<img");
    expect(templateStaticMarkup(rendered)).toContain('loading="lazy"');
    expect(templateValuesAfterMarker(rendered, "src=")).toEqual(["data:image/png;base64,QUJD"]);

    if (!Reflect.set(view, "pinnedToBottom", true)) throw new Error("Could not set ChatView.pinnedToBottom");
    onLoad(new Event("load"));
    if (!Reflect.set(view, "pinnedToBottom", false)) throw new Error("Could not set ChatView.pinnedToBottom");
    onLoad(new Event("load"));

    expect(scrollCalls).toBe(1);
  });

  // Direct rendering keeps this node-environment test focused on the dedicated
  // tool-image presentation without introducing a component-wide DOM shim.
  it("renders tool images as labeled standard messages with final metadata", () => {
    const message: ChatLine = {
      role: "tool",
      parts: [{ type: "image", mimeType: "image/png", data: "QUJD" }],
      meta: { timestamp: "2026-07-13T22:00:00.000Z" },
    };
    const rendered = renderToolImageOutput(new ChatView(), message, 7, "read");
    const markup = templateStaticMarkup(rendered);

    expect(markup).toContain('class="msg tool-image-output"');
    expect(markup).not.toContain('class="msg tool"');
    expect(markup).toContain("<img");
    expect(templateValuesAfterMarker(rendered, '<b class="label">')).toEqual(["read 输出"]);
    expect(templateValuesAfterMarker(rendered, "title=")).toEqual([chatMessageMetadataLabel(message)]);
    expect(templateValuesAfterMarker(rendered, "data-scroll-anchor-id=")).toEqual(["m:7"]);
  });
});

type RenderPart = (this: ChatView, part: ChatLine["parts"][number], message?: ChatLine) => TemplateResult;
type RenderToolImageOutput = (this: ChatView, message: ChatLine, index: number, toolName?: string) => TemplateResult;
type TemplateEventHandler = (event: Event) => void;

function renderPart(view: ChatView, part: ChatLine["parts"][number], message?: ChatLine): TemplateResult {
  const method: unknown = Reflect.get(view, "renderPart");
  if (!isRenderPart(method)) throw new Error("ChatView.renderPart is not callable");
  return method.call(view, part, message);
}

function renderToolImageOutput(view: ChatView, message: ChatLine, index: number, toolName?: string): TemplateResult {
  const method: unknown = Reflect.get(view, "renderToolImageOutput");
  if (!isRenderToolImageOutput(method)) throw new Error("ChatView.renderToolImageOutput is not callable");
  return method.call(view, message, index, toolName);
}

function templateEventHandler(template: TemplateResult, marker: string): TemplateEventHandler {
  const strings = templateStrings(template);
  const values = templateValues(template);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (strings[index]?.includes(marker) === true && isTemplateEventHandler(value)) return value;
  }
  throw new Error(`Expected template event handler after ${marker}`);
}

function isRenderPart(value: unknown): value is RenderPart {
  return typeof value === "function";
}

function isRenderToolImageOutput(value: unknown): value is RenderToolImageOutput {
  return typeof value === "function";
}

function isTemplateEventHandler(value: unknown): value is TemplateEventHandler {
  return typeof value === "function";
}

function templateStaticMarkup(template: TemplateResult): string {
  const chunks: string[] = [];
  visit(template);
  return chunks.join("");

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isTemplateResult(value)) return;
    chunks.push(...templateStrings(value));
    for (const child of templateValues(value)) visit(child);
  }
}

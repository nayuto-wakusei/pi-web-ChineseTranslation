// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { FileIcon } from "./FileIcon";

customElements.define("test-file-icon", FileIcon);
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("file icon mask boundary", () => {
  it("uses decorative monochrome masks and falls back on load failure, then accepts a changed URL", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const icon = new FileIcon();
    document.body.append(icon);
    await icon.updateComplete;
    expect(icon.shadowRoot?.querySelector("svg")).not.toBeNull();
    icon.url = "https://icons.example/typescript.svg";
    await icon.updateComplete;
    const image = icon.shadowRoot?.querySelector("img");
    expect(image?.alt).toBe("");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image?.hidden).toBe(true);
    expect(image?.crossOrigin).toBe("anonymous");
    expect(icon.shadowRoot?.querySelector("svg")).not.toBeNull();
    image?.dispatchEvent(new Event("load"));
    await icon.updateComplete;
    expect(icon.shadowRoot?.querySelector("svg")).toBeNull();
    expect(icon.shadowRoot?.querySelector<HTMLElement>(".mask")?.style.maskImage).toBe(`url("${icon.url}")`);
    expect(icon.shadowRoot?.querySelector(".mask")?.getAttribute("aria-hidden")).toBe("true");
    image?.dispatchEvent(new Event("error"));
    await icon.updateComplete;
    expect(icon.shadowRoot?.querySelector("img")).toBeNull();
    expect(icon.shadowRoot?.querySelector(".mask")).toBeNull();
    expect(icon.shadowRoot?.querySelector("svg")).not.toBeNull();
    expect(warning).toHaveBeenCalledExactlyOnceWith("Failed to load file icon", icon.url);
    icon.url = "https://icons.example/typescript-light.svg";
    await icon.updateComplete;
    expect(icon.shadowRoot?.querySelector("img")?.src).toBe(icon.url);
    image?.dispatchEvent(new Event("error"));
    await icon.updateComplete;
    expect(icon.shadowRoot?.querySelector("img")?.src).toBe(icon.url);
    expect(warning).toHaveBeenCalledOnce();
    icon.url = "https://icons.example/typescript.svg";
    await icon.updateComplete;
    expect(icon.shadowRoot?.querySelector("img")?.src).toBe(icon.url);
  });
});

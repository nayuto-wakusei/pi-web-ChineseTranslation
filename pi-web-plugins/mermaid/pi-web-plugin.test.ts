// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { html, svg } from "lit";
import type { PluginActivationContext } from "@chainingintention/pi-web-cn/plugin-api";
import plugin from "./pi-web-plugin.js";
import { mermaidFrameDocument } from "./mermaidEngine.js";
import { sanitizeMermaidSvg } from "./mermaidSvg.js";

describe("bundled Mermaid plugin", () => {
  it("activates as a browser-only manual renderer without a server plugin", () => {
    expect(plugin.apiVersion).toBe(4);
    expect(plugin.requires).toEqual([expect.objectContaining({ pluginId: "pi-web", id: "content-rendering", version: 1 })]);
    const activation = plugin.activate(activationContext());
    if (activation instanceof Promise) throw new Error("Mermaid activation must stay synchronous");
    const renderer = activation.contributions.contentRenderers?.[0];
    expect(renderer).toEqual(expect.objectContaining({
      id: "diagram",
      languages: ["mermaid"],
      fileExtensions: ["mmd", "mermaid"],
    }));
    expect(renderer?.renderMode).toBeUndefined();
    expect(activation.contributions.actions).toBeUndefined();
    expect(activation.contributions.workspacePanels).toBeUndefined();
  });

  it("stays available in management embed", () => {
    vi.stubGlobal("location", { search: "?embed=management" });
    const activation = plugin.activate(activationContext());
    if (activation instanceof Promise) throw new Error("Mermaid activation must stay synchronous");
    expect(activation.contributions.contentRenderers).toEqual([expect.objectContaining({ id: "diagram" })]);
  });

  it("sandboxes the local engine and rejects active SVG", () => {
    const frame = mermaidFrameDocument("window.engineReady = true;");
    expect(frame).toContain("script-src 'unsafe-inline'");
    expect(frame).toContain("window.engineReady = true;");
    expect(frame).not.toContain("allow-same-origin");
    const clean = sanitizeMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg"><text onclick="bad()">图表</text></svg>');
    expect(clean).toContain("图表");
    expect(clean).not.toContain("onclick");
    expect(() => sanitizeMermaidSvg('<svg><script>bad()</script></svg>')).toThrow("不受支持");
  });
});

function activationContext(): PluginActivationContext {
  return {
    apiVersion: 4,
    pluginId: "mermaid",
    runtimePluginId: "mermaid",
    html,
    svg,
    signal: new AbortController().signal,
    lifetimeSignal: new AbortController().signal,
  };
}

// @vitest-environment happy-dom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { html } from "lit";
import { PluginRegistry } from "../src/client/src/plugins/registry.ts";
import { FileIconService, fileIconsCapabilityToken } from "../src/client/src/fileIconService.ts";
import { adaptPublicPlugin } from "../src/client/src/plugins/publicContext.ts";
import { ContentRenderingBoundary } from "../src/client/src/components/ContentRenderingBoundary.ts";
import { ContentRendererHost } from "../src/client/src/components/ContentRendererHost.ts";
import { settleDeferredContent, useDeferredContent } from "../src/client/src/formatting/deferredContent.testSupport.ts";

useDeferredContent();
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

function query(root, selector) {
  const direct = root.querySelector(selector);
  if (direct !== null) return direct;
  if (root.shadowRoot !== undefined && root.shadowRoot !== null) {
    const nested = query(root.shadowRoot, selector);
    if (nested !== null) return nested;
  }
  for (const element of root.querySelectorAll("*")) {
    if (element.shadowRoot !== null) {
      const found = query(element.shadowRoot, selector);
      if (found !== null) return found;
    }
  }
  return null;
}
async function settleTree(root) {
  if ("updateComplete" in root) await root.updateComplete;
  if (root.shadowRoot !== undefined && root.shadowRoot !== null) await settleTree(root.shadowRoot);
  for (const child of root.children) await settleTree(child);
}
async function settle(viewer) {
  await settleTree(viewer); await settleDeferredContent(viewer); await settleTree(viewer);
  await settleDeferredContent(viewer); await settleTree(viewer);
}

// Built production-Lit document contributions must interoperate with the dev-Lit
// host and text-renderer adapters. Source-only tests cannot catch this boundary.
it("loads saved Markdown Preview through the bundled Files plugin without crossing Lit directive runtimes", async () => {
  const files = await import(pathToFileURL(resolve("dist/pi-web-plugins/files/browser/pi-web-plugin.js")).href);
  const registry = new PluginRegistry({ hostCapabilities: [{ capability: fileIconsCapabilityToken, value: new FileIconService().capability }] });
  let content;
  try {
    await registry.register({ id: "diagram", plugin: adaptPublicPlugin({ apiVersion: 5, name: "Diagram", activate: () => ({ contributions: {
      contentRenderers: [{ id: "diagram", languages: ["diagram"], render: ({ text }) => html`<b>${text}</b>` }],
    } }) }) });
    await registry.register({ id: "files", plugin: adaptPublicPlugin({ ...files.default, activate(context) {
      const activation = files.default.activate(context);
      content = activation.contributions.workspacePanels[0].render({}).values.find((value) => value?.localization === context.localization);
      return activation;
    } }) });
    expect(content).toBeDefined();
    const viewer = document.createElement("pi-web-files-viewer");
    const text = "# Notes\n\n> ```diagram\n> source\n> ```\n\n[Safe](https://example.test)\n\n<script>bad()</script>";
    const unavailable = () => { throw new Error("Unused artifact fixture file operation"); };
    Object.assign(viewer, {
      content, machineId: "local", projectId: "project", workspaceId: "workspace", selectedPath: "notes.md",
      modeStore: { adopt: () => "preview", publish: () => undefined }, filePreviewing: registry.filePreviewing,
      files: {
        capabilityVersion: 1, defaultUploadFolder: "uploads", maxInlinePreviewBytes: 10 * 1024 * 1024,
        readFile: unavailable, listFiles: unavailable, writeFile: unavailable, deleteFile: unavailable, moveFile: unavailable,
        previewUrl: unavailable, downloadUrl: unavailable, uploadFile: unavailable,
      },
    });
    document.body.append(viewer); await settle(viewer);
    expect(query(viewer, '.viewer-status[role="status"]').textContent).toContain("Loading notes.md");
    viewer.file = { path: "notes.md", mediaType: "markdown", language: "markdown", encoding: "utf8", size: text.length,
      modifiedAt: "2026-10-06T00:00:00.000Z", content: text, truncated: false, binary: false };
    await settle(viewer);
    expect(query(viewer, "pi-web-content-rendering-boundary")).toBeInstanceOf(ContentRenderingBoundary);
    const preview = query(viewer, ".markdown-preview");
    expect(preview.querySelector("h1").textContent).toBe("Notes");
    expect(preview.querySelector("script")).toBeNull();
    expect(preview.querySelector("a").getAttribute("rel")).toBe("noopener noreferrer");
    expect(query(viewer, '.viewer-status[role="status"]')).toBeNull();
    const host = preview.querySelector("blockquote pi-web-content-renderer");
    expect(host).toBeInstanceOf(ContentRendererHost);
    await settleDeferredContent(host);
    expect(host.shadowRoot.querySelector("b").textContent).toBe("source");
    expect([...viewer.shadowRoot.querySelectorAll("button")].map((button) => button.textContent.trim())).toEqual(["Preview", "Raw"]);
  } finally { document.body.replaceChildren(); await registry.dispose(); }
});

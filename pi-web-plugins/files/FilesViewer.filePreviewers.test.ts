// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { html, type TemplateResult } from "lit";
import type { FileContentResponse, FilePreviewerInput, FilePreviewingCapability, WorkspaceFilesContextValue } from "@chainingintention/pi-web-cn/plugin-api";
import { createFilePreviewingCapability } from "../../src/client/src/plugins/filePreviewing";
import type { RegisteredFilePreviewer } from "../../src/client/src/plugins/filePreviewers";
import { FilePreviewerHost } from "../../src/client/src/components/FilePreviewerHost";
import { filesLocalizationFixture } from "./filesLocalization.testSupport";
import { WorkspaceFileViewer } from "./FilesViewer";

if (customElements.get("pi-web-files-viewer") === undefined) customElements.define("pi-web-files-viewer", WorkspaceFileViewer);

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const files: WorkspaceFilesContextValue = {
  readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn(),
};
const binary: FileContentResponse = {
  path: "model.bin", content: "", encoding: "utf8", binary: true, truncated: false,
  size: 10 * 1024 * 1024, modifiedAt: "2026-01-01",
};

function previewer(id: string, renderMode: "manual" | "automatic" = "manual", render = vi.fn<(input: FilePreviewerInput) => TemplateResult>(() => html`<b>${id}</b>`)): RegisteredFilePreviewer {
  return { id, title: id, renderMode, render, pluginId: "test", binding: { registrationPluginId: "test", sourcePluginId: "test" }, lifetime: new AbortController().signal };
}

async function settle(viewer: WorkspaceFileViewer): Promise<void> {
  await viewer.updateComplete;
  const host = viewer.renderRoot.querySelector<FilePreviewerHost>("pi-web-file-previewer");
  await host?.updateComplete;
  await viewer.updateComplete;
  await viewer.updateComplete;
}

async function mount(choices: RegisteredFilePreviewer[], file = binary, preference?: "raw" | "preview") {
  const viewer = new WorkspaceFileViewer();
  const publish = vi.fn();
  Object.assign(viewer, {
    content: filesLocalizationFixture().content,
    file, selectedPath: file.path, files,
    machineId: "local", projectId: "project", workspaceId: "workspace",
    filePreviewing: createFilePreviewingCapability(() => choices),
    modeStore: { adopt: () => preference, publish },
  });
  document.body.append(viewer);
  await settle(viewer);
  return { viewer, publish };
}

function button(viewer: WorkspaceFileViewer, label: string): HTMLButtonElement {
  const found = [...viewer.renderRoot.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
  if (found === undefined) throw new Error(`Missing ${label} button`);
  return found;
}

function downloadAvailable(viewer: WorkspaceFileViewer): void {
  expect(viewer.renderRoot.querySelector(".viewer-header a[download]")).not.toBeNull();
}

describe("Files generic previewers", () => {
  it("discovers large binaries, authorizes manual rendering only on click, and passes workspace helpers", async () => {
    const draw = vi.fn<(input: FilePreviewerInput) => TemplateResult>(() => html`<b>Model</b>`);
    const { viewer } = await mount([previewer("Model", "manual", draw)], binary);
    expect(draw).not.toHaveBeenCalled();
    expect(viewer.renderRoot.textContent).not.toContain("Raw");
    downloadAvailable(viewer);
    button(viewer, "Model").click();
    await settle(viewer);
    expect(draw).toHaveBeenCalledOnce();
    expect(draw.mock.calls[0]?.[0]).toMatchObject({ files, machineId: "local", projectId: "project", workspaceId: "workspace", file: binary });
    expect(viewer.renderRoot.querySelector("pi-web-file-previewer")?.shadowRoot?.textContent).toContain("Model");
    downloadAvailable(viewer);
  });

  it("defaults to the last automatic choice without publishing a preference and supports switching", async () => {
    const draws = ["First", "Last", "Manual"].map(() => vi.fn<(input: FilePreviewerInput) => TemplateResult>(() => html`<b>preview</b>`));
    const choices = draws.map((draw, index) => previewer(["First", "Last", "Manual"][index] ?? "", index === 2 ? "manual" : "automatic", draw));
    const { viewer, publish } = await mount(choices);
    expect(draws.map((draw) => draw.mock.calls.length)).toEqual([0, 1, 0]);
    expect(button(viewer, "Last").getAttribute("aria-pressed")).toBe("true");
    expect(publish).not.toHaveBeenCalled();
    const oldInput = draws[1]?.mock.calls[0]?.[0];
    button(viewer, "First").click();
    await settle(viewer);
    expect(oldInput?.signal.aborted).toBe(true);
    expect(draws[0]).toHaveBeenCalledOnce();
    expect([...viewer.renderRoot.querySelectorAll(".viewer-mode button")].map((item) => item.textContent.trim())).toEqual(["First", "Last", "Manual"]);
    expect(viewer.renderRoot.querySelector("pi-web-file-previewer")).not.toBeNull();
    downloadAvailable(viewer);
  });

  it("does not offer Original or Raw for binary previews even with a remembered Raw preference", async () => {
    const file = { ...binary, path: "photo.png", mediaType: "image" as const, size: 100 };
    const { viewer } = await mount([previewer("Image", "automatic")], file, "raw");
    expect(button(viewer, "Image").getAttribute("aria-pressed")).toBe("true");
    expect([...viewer.renderRoot.querySelectorAll(".viewer-mode button")].map((item) => item.textContent.trim())).toEqual(["Image"]);
    expect(viewer.renderRoot.querySelector("pi-web-file-previewer")).not.toBeNull();
    downloadAvailable(viewer);
  });

  it("uses only contributed views for source formats and remembers named preview clicks", async () => {
    const file = { ...binary, path: "page.html", binary: false, size: 10, mediaType: "html" as const, content: "<p>source</p>" };
    const { viewer, publish } = await mount([previewer("Custom", "manual")], file);
    expect(viewer.renderRoot.querySelector("pi-web-files-code-viewer")).not.toBeNull();
    expect(viewer.renderRoot.querySelector("iframe")).toBeNull();
    expect(publish).not.toHaveBeenCalled();
    button(viewer, "Custom").click();
    await settle(viewer);
    expect(publish).toHaveBeenLastCalledWith("preview");
    button(viewer, "Raw").click();
    await settle(viewer);
    expect(viewer.renderRoot.querySelector("pi-web-files-code-viewer")).not.toBeNull();
    expect(publish).toHaveBeenLastCalledWith("raw");
    downloadAvailable(viewer);
  });

  it("honors legacy preview preference with the first manual choice, but prefers the last automatic", async () => {
    const { viewer } = await mount([previewer("Manual"), previewer("Other")], binary, "preview");
    expect(button(viewer, "Manual").getAttribute("aria-pressed")).toBe("true");
    viewer.filePreviewing = createFilePreviewingCapability(() => [previewer("Manual"), previewer("Auto", "automatic")]);
    await settle(viewer);
    expect(button(viewer, "Auto").getAttribute("aria-pressed")).toBe("true");
  });

  it.each(["sync", "async"] as const)("reports %s failures and falls back without a retry loop", async (failure) => {
    let input: FilePreviewerInput | undefined;
    const draw = vi.fn((value: FilePreviewerInput) => {
      input = value;
      if (failure === "sync") throw new Error("broken");
      return html`<b>preview</b>`;
    });
    const { viewer } = await mount([previewer("Broken", "automatic", draw)]);
    if (failure === "async") input?.fail(new Error("broken later"));
    await settle(viewer);
    expect(viewer.renderRoot.querySelector('[role="alert"]')?.textContent).toContain("Preview failed");
    expect(viewer.renderRoot.querySelector(".download-link")).not.toBeNull();
    expect(viewer.renderRoot.querySelector("pi-web-file-previewer")).toBeNull();
    viewer.requestUpdate();
    await settle(viewer);
    expect(draw).toHaveBeenCalledOnce();
    downloadAvailable(viewer);
    expect(viewer.renderRoot.textContent).not.toContain("Raw");
  });

  it("falls back to source after failure and preserves Download for unmatched files", async () => {
    const draw = vi.fn<(input: FilePreviewerInput) => TemplateResult>(() => { throw new Error("broken"); });
    const file = { ...binary, path: "notes.md", binary: false, size: 10, mediaType: "markdown" as const, content: "# source" };
    const choices = [previewer("Broken", "automatic", draw)];
    const { viewer } = await mount(choices, file, "preview");
    expect(viewer.renderRoot.querySelector("pi-web-files-code-viewer")).not.toBeNull();
    expect(viewer.renderRoot.querySelector(".markdown-preview")).toBeNull();
    expect(viewer.renderRoot.querySelector('[role="alert"]')).not.toBeNull();
    button(viewer, "Raw").click();
    await settle(viewer);
    expect(viewer.renderRoot.querySelector("pi-web-files-code-viewer")).not.toBeNull();
    choices.length = 0;
    viewer.requestUpdate();
    await settle(viewer);
    downloadAvailable(viewer);
  });

  it("resets manual choice per file/machine and ignores stale failures including A → B → A and previewer switches", async () => {
    const inputs: FilePreviewerInput[] = [];
    const draw = vi.fn((input: FilePreviewerInput) => { inputs.push(input); return html`<b>preview</b>`; });
    const { viewer } = await mount([previewer("Alpha", "manual", draw), previewer("Beta", "manual", draw)]);
    button(viewer, "Alpha").click();
    await settle(viewer);
    const first = inputs[0];
    button(viewer, "Beta").click();
    await settle(viewer);
    first?.fail("stale previewer");
    expect(first?.signal.aborted).toBe(true);
    expect(button(viewer, "Beta").getAttribute("aria-pressed")).toBe("true");
    viewer.file = { ...binary, path: "second.bin" };
    viewer.selectedPath = "second.bin";
    await settle(viewer);
    expect(viewer.renderRoot.querySelector("pi-web-file-previewer")).toBeNull();
    viewer.file = binary;
    viewer.selectedPath = binary.path;
    await settle(viewer);
    button(viewer, "Alpha").click();
    await settle(viewer);
    inputs[1]?.fail("stale file");
    first?.fail("stale A");
    await settle(viewer);
    expect(viewer.renderRoot.querySelector('[role="alert"]')).toBeNull();
    const current = inputs.at(-1);
    viewer.machineId = "remote";
    await settle(viewer);
    expect(current?.signal.aborted).toBe(true);
    current?.fail("old machine");
    expect(viewer.renderRoot.querySelector("pi-web-file-previewer")).toBeNull();
    expect(viewer.renderRoot.querySelector('[role="alert"]')).toBeNull();
    downloadAvailable(viewer);
  });

  it("honors Raw for source and resets named selection on file changes while retaining Preview preference", async () => {
    const file = { ...binary, path: "source.txt", binary: false, size: 6, content: "source" };
    const { viewer } = await mount([previewer("Manual"), previewer("Auto", "automatic")], file, "raw");
    expect(viewer.renderRoot.querySelector("pi-web-file-previewer")).toBeNull();
    button(viewer, "Manual").click();
    await settle(viewer);
    expect(button(viewer, "Manual").getAttribute("aria-pressed")).toBe("true");
    viewer.file = { ...file, path: "next.txt" };
    viewer.selectedPath = "next.txt";
    await settle(viewer);
    expect(button(viewer, "Auto").getAttribute("aria-pressed")).toBe("true");
    button(viewer, "Raw").click();
    await settle(viewer);
    viewer.requestUpdate();
    await settle(viewer);
    expect(viewer.renderRoot.querySelector("pi-web-file-previewer")).toBeNull();
    downloadAvailable(viewer);
  });

  it("guards consumer callbacks when the capability fails outside its host boundary", async () => {
    const callbacks: ((error: unknown) => void)[] = [];
    const capability: FilePreviewingCapability = {
      listPreviewers: () => [{ id: "custom", label: "Custom", renderMode: "manual" }],
      renderPreview: ({ fail }) => { callbacks.push(fail); return html`<b>custom</b>`; },
    };
    const { viewer } = await mount([]);
    viewer.filePreviewing = capability;
    await settle(viewer);
    button(viewer, "Custom").click();
    await settle(viewer);
    viewer.machineId = "other";
    await settle(viewer);
    button(viewer, "Custom").click();
    await settle(viewer);
    callbacks[0]?.("stale");
    await settle(viewer);
    expect(viewer.renderRoot.querySelector('[role="alert"]')).toBeNull();
    callbacks.at(-1)?.("current");
    await settle(viewer);
    expect(viewer.renderRoot.querySelector('[role="alert"]')).not.toBeNull();
    downloadAvailable(viewer);
  });
});

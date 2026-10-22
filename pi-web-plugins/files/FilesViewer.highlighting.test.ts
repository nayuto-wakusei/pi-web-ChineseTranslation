// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setTranslator } from "./i18n";
import { html } from "lit";
import { useDeferredContent, settleDeferredContent } from "../../src/client/src/formatting/deferredContent.testSupport";
import { createContentRenderingCapability } from "../../src/client/src/formatting/contentRendering";
import { ContentRendererHost } from "../../src/client/src/components/ContentRendererHost";
import type { ContentRenderingCapability, FileContentResponse } from "@chainingintention/pi-web-cn/plugin-api";
import type { WorkspaceFileViewMode, WorkspaceFileViewModeStore } from "./workspaceFileViewMode";
import { WorkspaceFileViewer } from "./FilesViewer";
if (customElements.get("pi-web-files-viewer") === undefined) customElements.define("pi-web-files-viewer", WorkspaceFileViewer);
useDeferredContent();
beforeEach(() => { setTranslator(undefined); });
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

it("defaults to the last automatic renderer, ignores later manual defaults, and preserves an explicit selection", async () => {
    const choices = [
      { id: "highlighted", label: "Highlighted", renderer: { id: "highlighted", renderMode: "automatic" as const, render: () => html`<b>Highlighted</b>` } },
      { id: "diagram", label: "Diagram", renderer: { id: "diagram", renderMode: "automatic" as const, render: () => html`<b>Diagram</b>` } },
    ];
    const manual = { id: "manual", label: "Manual", renderer: { id: "manual", render: () => html`<b>Manual</b>` } };
    const contentRendering = createContentRenderingCapability(() => [...choices, manual]);
    const viewer = await mountViewer(textFile("graph.mmd", "A --> B"), { contentRendering, modeStore: { adopt: () => undefined, publish: vi.fn() } });
    expect(viewer.renderRoot.querySelector("select")).toBeNull();
    expect([...viewer.renderRoot.querySelectorAll(".viewer-mode button")].map((item) => item.textContent.trim()))
      .toEqual(["Highlighted", "Diagram", "Manual", "Raw"]);
    expect(buttonWithText(viewer, "Diagram").getAttribute("aria-pressed")).toBe("true");
    buttonWithText(viewer, "Highlighted").click();
    await settleDeferredContent(viewer);
    choices.push({ id: "later", label: "Later", renderer: { id: "later", renderMode: "automatic", render: () => html`<b>Later</b>` } });
    viewer.requestUpdate();
    await settleDeferredContent(viewer);
    expect(buttonWithText(viewer, "Highlighted").getAttribute("aria-pressed")).toBe("true");
    modeButton(viewer, "Raw").click();
    await settleDeferredContent(viewer);
    expect(viewer.renderRoot.querySelector("pi-web-content-renderer")).toBeNull();
    expect(viewer.renderRoot.querySelector("pi-web-files-code-viewer")).not.toBeNull();
  });

it("owns standalone preview controls in the header and cancels the embedded renderer on Raw", async () => {
    let signal: AbortSignal | undefined;
    const contentRendering = createContentRenderingCapability(() => [{ id: "diagram", label: "Diagram", renderer: {
      id: "diagram", languages: ["diagram"], render: (input) => {
        signal = input.signal;
        return html`<b>Diagram preview</b>`;
      },
    } }]);
    const viewer = await mountViewer(textFile("graph.mmd", "A --> B"), { contentRendering });
    expect(signal).toBeUndefined();
    buttonWithText(viewer, "Diagram").click();
    await settleDeferredContent(viewer);
    const host = viewer.shadowRoot?.querySelector("pi-web-content-renderer");
    if (!(host instanceof ContentRendererHost)) throw new Error("Expected preview host");
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("button")).toBeNull();
    expect(host.shadowRoot?.textContent).toContain("Diagram preview");
    expect(viewer.shadowRoot?.querySelectorAll(".viewer-header button")).toHaveLength(2);
    expect(viewer.shadowRoot?.querySelector(".viewer-header a[download]")).not.toBeNull();
    modeButton(viewer, "Raw").click();
    await settleDeferredContent(viewer);
    expect(signal?.aborted).toBe(true);
    expect(viewer.shadowRoot?.querySelector("pi-web-content-renderer")).toBeNull();
    expect(viewer.shadowRoot?.querySelector("pi-web-files-code-viewer")).not.toBeNull();
    buttonWithText(viewer, "Diagram").click();
    await settleDeferredContent(viewer);
    const replacement = viewer.shadowRoot?.querySelector("pi-web-content-renderer");
    if (!(replacement instanceof ContentRendererHost)) throw new Error("Expected resumed preview");
    await settleDeferredContent(replacement);
    expect(signal?.aborted).toBe(false);
    const previousSignal = signal;
    viewer.file = textFile("graph.mmd", "changed source");
    await settleDeferredContent(viewer);
    const changedHost = viewer.shadowRoot?.querySelector<ContentRendererHost>("pi-web-content-renderer");
    await settleDeferredContent(changedHost ?? undefined);
    expect(previousSignal?.aborted).toBe(true);
    expect(signal).not.toBe(previousSignal);
    expect(changedHost?.shadowRoot?.querySelector("b")?.textContent).toBe("Diagram preview");
    expect(buttonWithText(viewer, "Diagram").getAttribute("aria-pressed")).toBe("true");
  });

it("chooses alternatives in the header, preserves choice across modes, and resets for a different file", async () => {
    const inputs: import("../../src/plugin-api").ContentRendererInput[] = [];
    const choices = ["Alpha", "Beta"].map((label) => ({ id: label, label, renderer: {
      id: label, render: (input: import("../../src/plugin-api").ContentRendererInput) => {
        inputs.push(input);
        return html`<b>${label}</b>`;
      },
    } }));
    const contentRendering = createContentRenderingCapability(() => choices);
    const viewer = await mountViewer(textFile("first.mmd", "source"), { contentRendering });
    expect(viewer.renderRoot.querySelector("select")).toBeNull();
    expect(buttonWithText(viewer, "Alpha").getAttribute("aria-pressed")).toBe("false");
    expect(inputs).toHaveLength(0);
    buttonWithText(viewer, "Alpha").click();
    await settleDeferredContent(viewer);
    const host = viewer.renderRoot.querySelector<ContentRendererHost>("pi-web-content-renderer");
    if (host === null) throw new Error("Expected preview host");
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("select,button")).toBeNull();
    expect(inputs).toHaveLength(1);
    buttonWithText(viewer, "Beta").click();
    await settleDeferredContent(viewer);
    await settleDeferredContent(host);
    expect(inputs[0]?.signal.aborted).toBe(true);
    expect(inputs).toHaveLength(2);
    expect(host.shadowRoot?.querySelector("b")?.textContent).toBe("Beta");
    buttonWithText(viewer, "Beta").click();
    await settleDeferredContent(viewer);
    await settleDeferredContent(host);
    expect(host.shadowRoot?.querySelector("b")?.textContent).toBe("Beta");
    expect(inputs).toHaveLength(2);
    modeButton(viewer, "Raw").click();
    await settleDeferredContent(viewer);
    expect(inputs[1]?.signal.aborted).toBe(true);
    expect(buttonWithText(viewer, "Raw").getAttribute("aria-pressed")).toBe("true");
    buttonWithText(viewer, "Beta").click();
    await settleDeferredContent(viewer);
    const resumed = viewer.renderRoot.querySelector<ContentRendererHost>("pi-web-content-renderer");
    if (resumed === null) throw new Error("Expected resumed preview");
    await settleDeferredContent(resumed);
    expect(resumed.shadowRoot?.querySelector("b")?.textContent).toBe("Beta");
    viewer.selectedPath = "second.mmd";
    viewer.file = textFile("second.mmd", "other");
    await settleDeferredContent(viewer);
    expect(buttonWithText(viewer, "Alpha").getAttribute("aria-pressed")).toBe("true");
  });

interface ViewerPatch {
  contentRendering?: ContentRenderingCapability;
  machineId?: string;
  projectId?: string;
  workspaceId?: string;
  selectedPath?: string | undefined;
  file?: FileContentResponse | undefined;
  loadError?: string | undefined;
  previewUrlBuilder?: WorkspaceFileViewer["previewUrlBuilder"];
  modeStore?: WorkspaceFileViewModeStore;
}

interface FakeModeStore extends WorkspaceFileViewModeStore {
  published: WorkspaceFileViewMode[];
}

function fakeModeStore(adopted: WorkspaceFileViewMode = "raw"): FakeModeStore {
  const published: WorkspaceFileViewMode[] = [];
  return {
    published,
    adopt: () => adopted,
    publish: (mode) => { published.push(mode); },
  };
}

async function mountViewer(file: FileContentResponse | undefined, patch: ViewerPatch = {}): Promise<WorkspaceFileViewer> {
  const viewer = new WorkspaceFileViewer();
  Object.assign(viewer, {
    machineId: "local",
    projectId: "project-1",
    workspaceId: "workspace-1",
    selectedPath: file?.path,
    file,
    loadError: undefined,
    previewUrlBuilder: inertPreviewUrl,
    modeStore: fakeModeStore(),
  }, patch);
  document.body.append(viewer);
  await settleDeferredContent(viewer);
  return viewer;
}

const inertPreviewUrl: WorkspaceFileViewer["previewUrlBuilder"] = (_projectId, _workspaceId, path, options) => {
  const params = new URLSearchParams({ path });
  if (options?.modifiedAt !== undefined) params.set("v", options.modifiedAt);
  if (options?.download === true) params.set("download", "1");
  return `about:blank?${params.toString()}`;
};

function textFile(path: string, content: string, patch: Partial<FileContentResponse> = {}): FileContentResponse {
  return {
    path,
    encoding: "utf8",
    size: content.length,
    modifiedAt: "2026-06-25T00:00:00.000Z",
    content,
    truncated: false,
    binary: false,
    ...patch,
  };
}

function modeButton(viewer: WorkspaceFileViewer, text: "Preview" | "Render" | "Raw"): HTMLButtonElement {
  return buttonWithText(viewer, text);
}

function buttonWithText(viewer: WorkspaceFileViewer | ContentRendererHost, text: string): HTMLButtonElement {
  const button = [...(viewer.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((candidate) => candidate.textContent.trim() === text);
  return requiredElement(button, `${text} button`);
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

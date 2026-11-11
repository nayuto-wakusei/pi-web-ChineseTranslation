// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { FilesCodeViewer } from "./FilesCodeViewer";
import { loadFilesViewerDependencies, type FilesViewerDependencies } from "./viewerLoader";

customElements.define("test-files-code-viewer", FilesCodeViewer);

afterEach(() => { document.body.replaceChildren(); });

it("recreates the current source after changes and reconnect", async () => {
  const viewer = new FilesCodeViewer();
  viewer.loadViewerDependencies = loadFilesViewerDependencies;
  viewer.content = "old";
  document.body.append(viewer);
  await vi.waitFor(() => { expect(viewer.shadowRoot?.querySelector(".cm-line")?.textContent).toBe("old"); });
  viewer.content = "new";
  await vi.waitFor(() => { expect(viewer.shadowRoot?.querySelector(".cm-line")?.textContent).toBe("new"); });
  viewer.remove();
  document.body.append(viewer);
  await vi.waitFor(() => { expect(viewer.shadowRoot?.querySelector(".cm-line")?.textContent).toBe("new"); });
  expect(viewer.shadowRoot?.querySelectorAll(".cm-editor")).toHaveLength(1);
});

it("only applies the current loader and retains readable source on failure", async () => {
  const viewer = new FilesCodeViewer();
  let rejectPrevious: (error: Error) => void = () => { throw new Error("Missing previous loader"); };
  let rejectActive: (error: Error) => void = () => { throw new Error("Missing active loader"); };
  const previous = new Promise<FilesViewerDependencies>((_resolve, reject) => { rejectPrevious = reject; });
  const active = new Promise<FilesViewerDependencies>((_resolve, reject) => { rejectActive = reject; });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    viewer.content = "<script>not executable</script>";
    viewer.loadingLabel = "Loading source";
    viewer.failureLabel = "Source viewer unavailable";
    viewer.loadViewerDependencies = () => previous;
    document.body.append(viewer);
    await vi.waitFor(() => { expect(viewer.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe("Loading source"); });
    viewer.loadViewerDependencies = () => active;
    await viewer.updateComplete;
    rejectPrevious(new Error("Old machine is offline"));
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();

    rejectActive(new Error("Current chunk is unavailable"));
    await vi.waitFor(() => { expect(viewer.shadowRoot?.querySelector('[role="alert"]')?.textContent).toBe("Source viewer unavailable"); });
    expect(viewer.shadowRoot?.querySelector("pre")?.textContent).toBe(viewer.content);
    expect(viewer.shadowRoot?.querySelector("script")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  } finally {
    warn.mockRestore();
  }
});

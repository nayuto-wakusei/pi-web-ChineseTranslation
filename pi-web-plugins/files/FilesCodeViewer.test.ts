// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { FilesCodeViewer } from "./FilesCodeViewer";

customElements.define("test-files-code-viewer", FilesCodeViewer);

afterEach(() => { document.body.replaceChildren(); });

it("recreates the current source after changes and reconnect", async () => {
  const viewer = new FilesCodeViewer();
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

// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { AppNavigationPanel } from "./AppNavigationPanel";
import type { ProjectList } from "../ProjectList";
import type { WorkspaceList } from "../WorkspaceList";

afterEach(() => { document.body.replaceChildren(); });

it("registers its list elements without a consumer importing their classes", async () => {
  const panel = new AppNavigationPanel();
  document.body.append(panel);
  await panel.updateComplete;
  const projects = panel.shadowRoot?.querySelector<ProjectList>("project-list");
  const workspaces = panel.shadowRoot?.querySelector<WorkspaceList>("workspace-list");
  await projects?.updateComplete;
  await workspaces?.updateComplete;
  expect(customElements.get("project-list")).toBeDefined();
  expect(customElements.get("workspace-list")).toBeDefined();
  expect(projects?.shadowRoot?.querySelector("section")).not.toBeNull();
  expect(workspaces?.shadowRoot?.querySelector("section")).not.toBeNull();
});

import { describe, expect, it, vi } from "vitest";
import type { ReactiveControllerHost } from "lit";
import { defaultNavigationSection, expandedNavigationSection, NavigationSectionsController } from "./navigationState";

describe("folder workspace navigation state", () => {
  it("never leaves an implicit or restored accordion on the hidden workspace section", () => {
    const state = { selectedProject: {}, selectedWorkspace: undefined, workspaceSelectionVisible: false };
    expect(defaultNavigationSection(state)).toBe("sessions");
    expect(expandedNavigationSection("workspaces", state)).toBe("sessions");
    expect(expandedNavigationSection("none", state)).toBeUndefined();
    expect(defaultNavigationSection({ ...state, selectedProject: undefined })).toBe("projects");
  });

  it("advances directly from projects to sessions without changing desktop collapse ownership", () => {
    const host: ReactiveControllerHost = { addController: vi.fn(), removeController: vi.fn(), requestUpdate: vi.fn(), updateComplete: Promise.resolve(true) };
    const state = { selectedProject: {}, selectedWorkspace: undefined, workspaceSelectionVisible: false };
    let mobile = true;
    const sections = new NavigationSectionsController(host, () => state, () => mobile);
    sections.expand("projects");
    sections.advanceAfterSelection("projects");
    expect(sections.expandedSection()).toBe("sessions");
    mobile = false;
    sections.toggle("projects");
    expect(sections.isCollapsed("projects")).toBe(true);
    expect(sections.isCollapsed("sessions")).toBe(false);
    sections.expand("projects");
    expect(sections.isCollapsed("projects")).toBe(false);
  });
});

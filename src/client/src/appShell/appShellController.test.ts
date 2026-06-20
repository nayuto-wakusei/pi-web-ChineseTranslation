import { describe, expect, it } from "vitest";
import { normalizeMainViewForLayout } from "./appShellController";

describe("normalizeMainViewForLayout", () => {
  it("uses the expected default view for mobile and desktop layouts", () => {
    expect(normalizeMainViewForLayout(undefined, {
      isMobileNavigationLayout: true,
      isStackedWorkspaceLayout: true,
      hasSelectedSession: false,
    })).toBe("navigation");

    expect(normalizeMainViewForLayout(undefined, {
      isMobileNavigationLayout: false,
      isStackedWorkspaceLayout: false,
      hasSelectedSession: false,
    })).toBe("chat");
  });

  it("keeps workspace views on wide and mobile layouts", () => {
    expect(normalizeMainViewForLayout("core:workspace.files", {
      isMobileNavigationLayout: false,
      isStackedWorkspaceLayout: false,
      hasSelectedSession: true,
    })).toBe("core:workspace.files");

    expect(normalizeMainViewForLayout("core:workspace.files", {
      isMobileNavigationLayout: true,
      isStackedWorkspaceLayout: true,
      hasSelectedSession: true,
    })).toBe("core:workspace.files");
  });

  it("prefers chat when a stacked workspace layout would otherwise hide the selected session", () => {
    expect(normalizeMainViewForLayout("core:workspace.files", {
      isMobileNavigationLayout: false,
      isStackedWorkspaceLayout: true,
      hasSelectedSession: true,
    })).toBe("chat");

    expect(normalizeMainViewForLayout("core:workspace.git", {
      isMobileNavigationLayout: false,
      isStackedWorkspaceLayout: true,
      hasSelectedSession: true,
    })).toBe("chat");
  });

  it("preserves explicit navigation and chat views in stacked layouts", () => {
    expect(normalizeMainViewForLayout("navigation", {
      isMobileNavigationLayout: false,
      isStackedWorkspaceLayout: true,
      hasSelectedSession: true,
    })).toBe("navigation");

    expect(normalizeMainViewForLayout("chat", {
      isMobileNavigationLayout: false,
      isStackedWorkspaceLayout: true,
      hasSelectedSession: true,
    })).toBe("chat");
  });
});

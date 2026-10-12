// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { AppShellController } from "./appShellController";

afterEach(() => { vi.restoreAllMocks(); });

function shell(mobile: boolean, desktop: boolean) {
  const mobileMedia = window.matchMedia("(max-width: 760px)");
  const desktopMedia = window.matchMedia("(min-width: 1181px)");
  vi.spyOn(mobileMedia, "matches", "get").mockReturnValue(mobile);
  vi.spyOn(desktopMedia, "matches", "get").mockReturnValue(desktop);
  const requestUpdate = vi.fn();
  const controller = new AppShellController({ addController: vi.fn(), removeController: vi.fn(), requestUpdate, updateComplete: Promise.resolve(true) }, {
    desktopSideBySideMedia: desktopMedia, mobileNavigationMedia: mobileMedia, pwaDisplayModeMedia: [],
  });
  return { controller, mobileMedia, desktopMedia, requestUpdate };
}

describe("canonical responsive shell", () => {
  it("uses Navigation on mobile and Chat elsewhere when the URL omits view", () => {
    expect(shell(true, false).controller.defaultRouteView()).toBe("navigation");
    expect(shell(false, true).controller.defaultRouteView()).toBe("chat");
    expect(shell(false, false).controller.defaultRouteView()).toBe("chat");
  });
  it("reports layout transitions without rewriting explicit Chat or Workspace state", () => {
    const { controller, desktopMedia, requestUpdate } = shell(false, true);
    const state = { ...initialAppState(), mainView: "workspace" as const, workspaceTool: "pi-web.files:workspace.files" as const };
    controller.hostConnected();
    desktopMedia.dispatchEvent(Object.assign(new Event("change"), { matches: false }));
    expect(controller.isDesktopSideBySideLayout).toBe(false);
    expect(requestUpdate).toHaveBeenCalledOnce();
    expect(state.mainView).toBe("workspace");
    expect(state.workspaceTool).toBe("pi-web.files:workspace.files");
    controller.hostDisconnected();
  });
  it("keeps mobile and desktop layout boundaries independent", () => {
    const { controller, mobileMedia } = shell(false, false);
    controller.hostConnected();
    mobileMedia.dispatchEvent(Object.assign(new Event("change"), { matches: true }));
    expect(controller.isMobileNavigationLayout).toBe(true);
    expect(controller.isDesktopSideBySideLayout).toBe(false);
    expect(controller.defaultRouteView()).toBe("navigation");
    expect(controller.shouldAutoFocusPrompt()).toBe(false);
    controller.hostDisconnected();
  });
  it("retires media listeners when the shell disconnects", () => {
    const { controller, desktopMedia, mobileMedia, requestUpdate } = shell(false, true);
    controller.hostConnected();
    controller.hostDisconnected();
    desktopMedia.dispatchEvent(Object.assign(new Event("change"), { matches: false }));
    mobileMedia.dispatchEvent(Object.assign(new Event("change"), { matches: true }));
    expect(requestUpdate).not.toHaveBeenCalled();
    expect(controller.isDesktopSideBySideLayout).toBe(true);
    expect(controller.isMobileNavigationLayout).toBe(false);
  });
});

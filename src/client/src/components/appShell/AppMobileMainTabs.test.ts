// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import "./AppMobileMainTabs";
import { AppMobileMainTabs } from "./AppMobileMainTabs";

afterEach(() => { document.body.replaceChildren(); });

describe("AppMobileMainTabs", () => {
  it("marks the navigation control active when the current destination is hidden", async () => {
    const tabs = new AppMobileMainTabs();
    tabs.tabs = [{ id: "chat", label: "聊天", icon: "chat" }];
    tabs.selectedTab = "core:workspace.git";
    tabs.hiddenActiveDestination = true;
    tabs.onShowNavigation = vi.fn();
    document.body.append(tabs);
    await tabs.updateComplete;

    const menu = tabs.renderRoot.querySelector<HTMLButtonElement>(".navigation-menu-button");
    expect(menu?.classList.contains("selected")).toBe(true);
    expect(menu?.getAttribute("aria-pressed")).toBe("true");
    expect(tabs.renderRoot.querySelector(".mobile-tabs button")?.getAttribute("aria-pressed")).toBe("false");
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import "./NavigationDialog";
import { NavigationDialog } from "./NavigationDialog";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("NavigationDialog", () => {
  it("filters destinations and commits the highlighted target", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const dialog = new NavigationDialog();
    dialog.tabs = [
      { id: "chat", label: "聊天", icon: "chat" },
      { id: "core:workspace.files", label: "文件", icon: "files" },
      { id: "core:workspace.git", label: "Git", icon: "git" },
    ];
    dialog.onSelect = onSelect;
    dialog.onClose = onClose;
    document.body.append(dialog);
    await dialog.updateComplete;

    const input = dialog.renderRoot.querySelector<HTMLInputElement>("input");
    if (input === null) throw new Error("Navigation search was not rendered");
    input.value = "git";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await dialog.updateComplete;

    expect(dialog.renderRoot.querySelectorAll(".destination-button")).toHaveLength(1);
    expect(dialog.renderRoot.querySelector(".destination-button")?.textContent).toBe("Git");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));

    expect(onSelect).toHaveBeenCalledWith("core:workspace.git");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("toggles navigation pins independently from destination selection", async () => {
    const onPreferencesChange = vi.fn();
    const dialog = new NavigationDialog();
    dialog.tabs = [
      { id: "chat", label: "聊天", icon: "chat" },
      { id: "core:workspace.files", label: "文件", icon: "files" },
    ];
    dialog.pinUniverse = ["chat", "core:workspace.files"];
    dialog.preferences = { pinnedIds: [] };
    dialog.onPreferencesChange = onPreferencesChange;
    document.body.append(dialog);
    await dialog.updateComplete;

    const pin = dialog.renderRoot.querySelector<HTMLButtonElement>(".pin-button");
    if (pin === null) throw new Error("Navigation pin control was not rendered");
    pin.click();

    expect(onPreferencesChange).toHaveBeenCalledWith({ pinnedIds: ["core:workspace.files"] });
    expect(dialog.renderRoot.querySelector("input")?.getAttribute("aria-describedby")).toBe("navigation-selection");
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { svg } from "lit";
import "./NavigationDialog";
import { NavigationDialog } from "./NavigationDialog";
import type { ModalSurface } from "../ModalSurface";
import { deepActiveElement } from "../modalLayerRegistry";

const filesIcon = svg`<svg viewBox="0 0 24 24"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"></path></svg>`;
const gitIcon = svg`<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2"></circle><circle cx="18" cy="6" r="2"></circle><circle cx="12" cy="18" r="2"></circle></svg>`;

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});
it("focuses search, supports button navigation and traps Tab, then restores focus on Escape", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const dialog = new NavigationDialog();
  dialog.tabs = [{ id: "chat", label: "Chat" }, { id: "tools:files", label: "Files" }];
  dialog.selectedTab = "tools:files";
  dialog.onClose = () => { dialog.remove(); };
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => undefined);
  document.body.append(dialog);
  await dialog.updateComplete;
  const surface = dialog.shadowRoot?.querySelector<ModalSurface>("modal-surface");
  if (surface == null) throw new Error("Expected shared modal surface");
  await surface.updateComplete;
  expect(surface.shadowRoot?.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("导航");
  const input = dialog.shadowRoot?.querySelector("input");
  expect(deepActiveElement(document)).toBe(input);
  dialog.shadowRoot?.querySelector<HTMLButtonElement>('.destination-button[aria-pressed="true"]')?.focus();
  const key = (value: string, shiftKey = false) => {
    const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, composed: true, cancelable: true });
    deepActiveElement(document)?.dispatchEvent(event);
    return event;
  };
  expect(key("ArrowUp").defaultPrevented).toBe(true);
  expect(deepActiveElement(document)?.textContent).toBe("Chat");
  key("End");
  expect(deepActiveElement(document)?.textContent).toBe("Files");
  key("Home");
  expect(deepActiveElement(document)?.textContent).toBe("Chat");
  expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  input?.focus();
  expect(key("Tab", true).defaultPrevented).toBe(true);
  expect(deepActiveElement(document)?.textContent).toBe("折叠");
  expect(key("Tab").defaultPrevented).toBe(true);
  expect(deepActiveElement(document)).toBe(input);
  const composingEscape = new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, composed: true, cancelable: true });
  input?.dispatchEvent(composingEscape);
  expect(composingEscape.defaultPrevented).toBe(false);
  expect(dialog.isConnected).toBe(true);
  expect(key("Escape").defaultPrevented).toBe(true);
  expect(dialog.isConnected).toBe(false);
  expect(deepActiveElement(document)).toBe(opener);
});

it("filters destinations and navigates results from search without changing pins", async () => {
  const dialog = new NavigationDialog();
  dialog.tabs = [{ id: "chat", label: "Chat" }, { id: "tools:files", label: "Files" }, { id: "tools:find", label: "Find" }];
  dialog.onSelect = vi.fn();
  dialog.onClose = vi.fn();
  dialog.onPreferencesChange = vi.fn();
  document.body.append(dialog);
  await dialog.updateComplete;
  const input = dialog.shadowRoot?.querySelector("input");
  if (input == null) throw new Error("Expected navigation search input");
  const search = async (query: string) => {
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await dialog.updateComplete;
  };
  const key = async (key: string) => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true }));
    await dialog.updateComplete;
  };
  const selected = () => dialog.shadowRoot?.querySelector('.destination-button.selected')?.textContent;
  const announcement = () => dialog.shadowRoot?.querySelector('[role="status"]')?.textContent;
  await search(" FI ");
  expect(dialog.shadowRoot?.querySelectorAll(".destination-button")).toHaveLength(2);
  expect(selected()).toBe("Files");
  expect(input.getAttribute("aria-describedby")).toBe("navigation-selection");
  expect(announcement()).toBe("Files，第 1 项，共 2 项");
  await key("ArrowUp");
  expect(selected()).toBe("Find");
  expect(announcement()).toBe("Find，第 2 项，共 2 项");
  expect(dialog.shadowRoot?.querySelector('[aria-current]')).toBeNull();
  await key("ArrowDown");
  expect(selected()).toBe("Files");
  await key("End");
  expect(selected()).toBe("Find");
  await key("Home");
  expect(selected()).toBe("Files");
  const composingEnter = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, composed: true, cancelable: true });
  input.dispatchEvent(composingEnter);
  expect(composingEnter.defaultPrevented).toBe(false);
  expect(dialog.onSelect).not.toHaveBeenCalled();
  await key("Enter");
  expect(dialog.onSelect).toHaveBeenCalledWith("tools:files");
  expect(dialog.onClose).toHaveBeenCalledOnce();
  expect(dialog.onPreferencesChange).not.toHaveBeenCalled();
  await search("missing");
  expect(dialog.shadowRoot?.textContent).toContain("没有匹配的导航目标。");
  expect(announcement()).toBe("没有匹配的导航目标。");
  await key("ArrowDown");
  await key("Enter");
  expect(dialog.onSelect).toHaveBeenCalledOnce();
  await search("");
  expect(selected()).toBe("Chat");
});

it("offers unpinned destinations and closes after navigating without modifying pins", async () => {
  const dialog = new NavigationDialog();
  dialog.tabs = [{ id: "chat", label: "Chat" }, { id: "tools:files", label: "Files" }];
  dialog.preferences = { pinnedIds: ["chat", "missing:tool"], mobileCollapsed: true };
  dialog.selectedTab = "tools:files";
  dialog.onSelect = vi.fn();
  dialog.onClose = vi.fn();
  dialog.onPreferencesChange = vi.fn();
  document.body.append(dialog);
  await dialog.updateComplete;
  const pin = dialog.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="固定：Files"]');
  expect(pin?.getAttribute("aria-pressed")).toBe("false");
  expect(pin?.querySelector("svg")).not.toBeNull();
  const files = dialog.shadowRoot?.querySelector<HTMLButtonElement>('.destination > button:first-child[aria-pressed="true"]');
  expect(files?.textContent).toBe("Files");
  files?.click();
  expect(dialog.onSelect).toHaveBeenCalledWith("tools:files");
  expect(dialog.onClose).toHaveBeenCalledOnce();
  expect(dialog.onPreferencesChange).not.toHaveBeenCalled();
});

it("toggles icon pins and mobile layout independently, resets tabs, and uses shared Escape handling", async () => {
  const dialog = new NavigationDialog();
  dialog.tabs = [{ id: "chat", label: "Chat" }, { id: "tools:files", label: "Files" }];
  dialog.preferences = { pinnedIds: ["chat", "missing:tool"], mobileCollapsed: true };
  dialog.onPreferencesChange = (preferences) => { dialog.preferences = preferences; };
  dialog.onClose = vi.fn();
  document.body.append(dialog);
  await dialog.updateComplete;
  dialog.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="固定：Files"]')?.click();
  await dialog.updateComplete;
  expect(dialog.preferences).toEqual({ pinnedIds: ["chat", "missing:tool", "tools:files"], mobileCollapsed: true });
  expect(dialog.shadowRoot?.querySelector('button[aria-label="取消固定：Files"]')?.getAttribute("aria-pressed")).toBe("true");
  const modes = [...dialog.shadowRoot?.querySelectorAll<HTMLButtonElement>('.mobile-navigation button') ?? []];
  expect(modes.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  modes[0]?.click();
  await dialog.updateComplete;
  expect(dialog.preferences).toEqual({ pinnedIds: ["chat", "missing:tool", "tools:files"], mobileCollapsed: false });
  expect(modes.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  modes[1]?.click();
  await dialog.updateComplete;
  dialog.shadowRoot?.querySelector<HTMLButtonElement>("footer button")?.click();
  await dialog.updateComplete;
  expect(dialog.preferences).toEqual({ pinnedIds: [], mobileCollapsed: true });
  expect([...dialog.shadowRoot?.querySelectorAll(".pin-button") ?? []].every((button) => button.getAttribute("aria-pressed") === "true")).toBe(true);
  expect(dialog.shadowRoot?.querySelector('input[type="checkbox"]')).toBeNull();
  const surface = dialog.shadowRoot?.querySelector<ModalSurface>("modal-surface");
  if (surface == null) throw new Error("Expected shared modal surface");
  await surface.updateComplete;
  deepActiveElement(document)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
  expect(dialog.onClose).toHaveBeenCalledOnce();
});

describe("NavigationDialog", () => {
  it("filters destinations and commits the highlighted target", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const dialog = new NavigationDialog();
    dialog.tabs = [
      { id: "chat", label: "聊天", icon: "chat" },
      { id: "pi-web.files:workspace.files", label: "文件", icon: filesIcon },
      { id: "pi-web.git:workspace.git", label: "Git", icon: gitIcon },
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

    expect(onSelect).toHaveBeenCalledWith("pi-web.git:workspace.git");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("toggles navigation pins independently from destination selection", async () => {
    const onPreferencesChange = vi.fn();
    const dialog = new NavigationDialog();
    dialog.tabs = [
      { id: "chat", label: "聊天", icon: "chat" },
      { id: "pi-web.files:workspace.files", label: "文件", icon: filesIcon },
    ];
    dialog.pinUniverse = ["chat", "pi-web.files:workspace.files"];
    dialog.preferences = { pinnedIds: [], mobileCollapsed: false };
    dialog.onPreferencesChange = onPreferencesChange;
    document.body.append(dialog);
    await dialog.updateComplete;

    const pin = dialog.renderRoot.querySelector<HTMLButtonElement>(".pin-button");
    if (pin === null) throw new Error("Navigation pin control was not rendered");
    pin.click();

    expect(onPreferencesChange).toHaveBeenCalledWith({ pinnedIds: ["pi-web.files:workspace.files"], mobileCollapsed: false });
    expect(dialog.renderRoot.querySelector("input")?.getAttribute("aria-describedby")).toBe("navigation-selection");
  });

  it("keeps unavailable-layout pin preferences intact and controls mobile collapse", async () => {
    const onPreferencesChange = vi.fn();
    const dialog = new NavigationDialog();
    dialog.tabs = [{ id: "pi-web.files:workspace.files", label: "文件", icon: filesIcon }];
    dialog.pinUniverse = ["chat", "pi-web.files:workspace.files"];
    dialog.preferences = { pinnedIds: ["chat"], mobileCollapsed: false };
    dialog.onPreferencesChange = onPreferencesChange;
    document.body.append(dialog);
    await dialog.updateComplete;

    dialog.renderRoot.querySelector<HTMLButtonElement>(".mobile-navigation button:last-child")?.click();
    expect(onPreferencesChange).toHaveBeenCalledWith({ pinnedIds: ["chat"], mobileCollapsed: true });
    onPreferencesChange.mockClear();
    dialog.renderRoot.querySelector<HTMLButtonElement>(".pin-button")?.click();
    expect(onPreferencesChange).toHaveBeenCalledWith({ pinnedIds: ["chat", "pi-web.files:workspace.files"], mobileCollapsed: false });
  });
});

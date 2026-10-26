// @vitest-environment happy-dom

import type { ManagedAgentsControl, ManagedAgentsStatus } from "@chainingintention/pi-web-cn/plugin-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installPopoverFake } from "../../src/client/src/components/anchoredPopup.testSupport";
import { ManagedAgentsMenu } from "./ManagedAgentsMenu";

installPopoverFake();

const pending: Extract<ManagedAgentsStatus, { available: true }> = {
  available: true, pending: true, revision: "snapshot-1", modifiedAt: "2026-10-20T00:00:00Z", templateRevision: "org-r2", templateModifiedAt: "2026-10-26T00:00:00Z",
};

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mount(control?: ManagedAgentsControl) {
  const status = vi.fn<ManagedAgentsControl["status"]>().mockResolvedValue(pending);
  const decide = vi.fn<ManagedAgentsControl["decide"]>().mockResolvedValue({ ...pending, pending: false });
  const menu = new ManagedAgentsMenu();
  menu.control = control ?? { status, decide };
  menu.scopeKey = "machine/project/workspace";
  document.body.append(menu);
  await menu.updateComplete;
  await menu.updateComplete;
  return { menu, status, decide };
}

function button(menu: ManagedAgentsMenu, selector: string): HTMLButtonElement {
  const result = menu.shadowRoot?.querySelector<HTMLButtonElement>(selector);
  if (result === null || result === undefined) throw new Error(`Missing button: ${selector}`);
  return result;
}

async function open(menu: ManagedAgentsMenu): Promise<void> {
  button(menu, ".agents-trigger").click();
  await menu.updateComplete;
}

describe("managed AGENTS review menu", () => {
  it.each(["keep", "overwrite"] as const)("acknowledges only the explicit %s action", async (action) => {
    const { menu, status, decide } = await mount();
    const applied = vi.fn();
    menu.addEventListener("agents-applied", applied);
    status.mockResolvedValue({ ...pending, pending: false });
    expect(button(menu, ".agents-trigger").classList.contains("pending")).toBe(true);
    await open(menu);
    expect(button(menu, ".agents-trigger").getAttribute("aria-expanded")).toBe("true");
    expect(menu.shadowRoot?.textContent).toContain("2026-10-26T00:00:00Z");
    button(menu, action === "keep" ? "[data-keep]" : "[data-overwrite]").click();
    await menu.updateComplete;
    await menu.updateComplete;
    expect(decide).toHaveBeenCalledExactlyOnceWith({ action, revision: "snapshot-1" });
    expect(button(menu, ".agents-trigger").classList.contains("pending")).toBe(false);
    expect(button(menu, ".agents-trigger").getAttribute("aria-expanded")).toBe("false");
    expect(applied).toHaveBeenCalledTimes(action === "overwrite" ? 1 : 0);
  });

  it.each(["close", "escape", "outside"])("retains notification when dismissed with %s", async (method) => {
    const { menu, decide } = await mount();
    await open(menu);
    if (method === "close") button(menu, ".close").click();
    else if (method === "escape") menu.shadowRoot?.querySelector("[popover]")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else document.body.click();
    await menu.updateComplete;
    expect(button(menu, ".agents-trigger").getAttribute("aria-expanded")).toBe("false");
    expect(button(menu, ".agents-trigger").classList.contains("pending")).toBe(true);
    expect(decide).not.toHaveBeenCalled();
  });

  it("keeps the notification and error when a stale decision is rejected", async () => {
    const { menu, status, decide } = await mount();
    decide.mockRejectedValue(Object.assign(new Error("File changed; refresh"), { status: 409 }));
    await open(menu);
    button(menu, "[data-overwrite]").click();
    await menu.updateComplete;
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector("[role=alert]")?.textContent).toContain("File changed; refresh");
    expect(button(menu, ".agents-trigger").classList.contains("pending")).toBe(true);
    expect(status.mock.calls.length).toBeGreaterThan(1);
  });

  it("ignores an old scope's delayed response", async () => {
    let finish!: (value: ManagedAgentsStatus) => void;
    const oldStatus = vi.fn<ManagedAgentsControl["status"]>(() => new Promise((resolve) => { finish = resolve; }));
    const { menu } = await mount({ status: oldStatus, decide: vi.fn() });
    menu.scopeKey = "different-machine/project/workspace";
    menu.control = { status: () => Promise.resolve({ available: false }), decide: vi.fn() };
    await menu.updateComplete;
    await menu.updateComplete;
    finish(pending);
    await Promise.resolve();
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector(".agents-trigger")).toBeNull();
  });

  it("closes an unavailable capability without reopening when it returns", async () => {
    const { menu, status } = await mount();
    await open(menu);
    status.mockResolvedValue({ available: false });
    await menu.refresh();
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector(".agents-trigger")).toBeNull();
    status.mockResolvedValue(pending);
    await menu.refresh();
    await menu.updateComplete;
    expect(button(menu, ".agents-trigger").getAttribute("aria-expanded")).toBe("false");
    expect(menu.shadowRoot?.querySelector("[popover]")).toBeNull();
  });

  it("keeps the opened revision stable while a newer file snapshot arrives", async () => {
    const { menu, status, decide } = await mount();
    await open(menu);
    status.mockResolvedValue({ ...pending, revision: "snapshot-2", modifiedAt: "2026-10-26T02:00:00Z" });
    await menu.refresh();
    await menu.updateComplete;
    expect(menu.shadowRoot?.textContent).not.toContain("2026-10-26T02:00:00Z");
    button(menu, "[data-overwrite]").click();
    await menu.updateComplete;
    expect(decide).toHaveBeenCalledWith({ action: "overwrite", revision: "snapshot-1" });
  });

  it("refreshes after reconnecting during an unfinished decision", async () => {
    const { menu, status, decide } = await mount();
    let finish!: (value: ManagedAgentsStatus) => void;
    decide.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await open(menu);
    button(menu, "[data-keep]").click();
    await menu.updateComplete;
    menu.remove();
    status.mockResolvedValue({ ...pending, pending: false });
    document.body.append(menu);
    await menu.updateComplete;
    await menu.updateComplete;
    expect(button(menu, ".agents-trigger").classList.contains("pending")).toBe(false);
    finish(pending);
    await Promise.resolve();
    await menu.updateComplete;
    expect(button(menu, ".agents-trigger").classList.contains("pending")).toBe(false);
  });

  it("does not restart polling after a detached request resolves", async () => {
    vi.useFakeTimers();
    let finish!: (value: ManagedAgentsStatus) => void;
    const status = vi.fn<ManagedAgentsControl["status"]>(() => new Promise((resolve) => { finish = resolve; }));
    const { menu } = await mount({ status, decide: vi.fn() });
    const signal = status.mock.calls[0]?.[0]?.signal;
    menu.remove();
    expect(signal?.aborted).toBe(true);
    finish(pending);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(status).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes serially on the next poll and detects renewed pending state", async () => {
    vi.useFakeTimers();
    const { menu, status } = await mount();
    status.mockResolvedValue({ ...pending, pending: false });
    await vi.advanceTimersByTimeAsync(30_000);
    await menu.updateComplete;
    expect(button(menu, ".agents-trigger").classList.contains("pending")).toBe(false);
    status.mockResolvedValue({ ...pending, revision: "snapshot-2" });
    await vi.advanceTimersByTimeAsync(30_000);
    await menu.updateComplete;
    expect(button(menu, ".agents-trigger").classList.contains("pending")).toBe(true);
  });
});

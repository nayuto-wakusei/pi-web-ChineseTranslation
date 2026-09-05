// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { Machine, WorkspaceActivity } from "../api";
import { MachineSwitcher } from "./MachineSwitcher";

afterEach(() => {
  document.body.replaceChildren();
});

describe("machine-switcher unread indicator", () => {
  it("shows an unread dot on the switcher button while the selected machine has unread sessions", async () => {
    const switcher = await mountSwitcher([machine("local", "local"), machine("remote-a", "remote")], new Set(["local"]));
    const button = switcherButton(switcher);
    const dot = button.querySelector(".activity-indicator.unread");
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("title")).toBe("此机器上有未读会话");

    switcher.unreadMachineIds = new Set();
    await switcher.updateComplete;

    expect(switcherButton(switcher).querySelector(".activity-indicator.unread")).toBeNull();
  });

  it("marks only the unread machines among the dropdown options", async () => {
    const switcher = await mountSwitcher(
      [machine("local", "local"), machine("remote-a", "remote"), machine("remote-b", "remote")],
      new Set(["remote-b"]),
    );

    switcherButton(switcher).click();
    await switcher.updateComplete;

    expect(unreadDot(optionFor(switcher, "local"))).toBeNull();
    expect(unreadDot(optionFor(switcher, "remote-a"))).toBeNull();
    expect(unreadDot(optionFor(switcher, "remote-b"))).not.toBeNull();
  });

  it("wraps the work dot in an unread ring when the machine is busy and unread", async () => {
    const switcher = await mountSwitcher([machine("local", "local"), machine("remote-a", "remote")], new Set(["local"]));
    switcher.activities = { local: { "/repo": workspaceActivity("/repo", true, false) } };
    await switcher.updateComplete;

    const button = switcherButton(switcher);
    const ring = button.querySelector(".unread-ring");
    expect(ring?.querySelector(".activity-indicator.session")).not.toBeNull();
    expect(ring?.getAttribute("title")).toBe("此机器上有未读会话 · 机器活动中");
    // One mark only: the ring replaces the standalone unread dot.
    expect(button.querySelector(".activity-indicator.unread")).toBeNull();
  });
});

describe("machine identity", () => {
  it("renders nothing for one machine in browser mode", async () => {
    const switcher = await mountSwitcher([machine("local", "local")], new Set());

    expect(switcher.shadowRoot?.querySelector(".machine-info")).toBeNull();
    expect(switcher.shadowRoot?.querySelector(".machine-switcher-button")).toBeNull();
  });

  it("shows a static local gateway bubble for one machine in PWA mode", async () => {
    const switcher = await mountSwitcher([machine("local", "local")], new Set(), true);

    const info = switcher.shadowRoot?.querySelector<HTMLElement>(".machine-info");
    expect(info?.querySelector<HTMLImageElement>(".machine-icon")?.getAttribute("src")).toBe(`${document.baseURI}favicon.svg`);
    expect(info?.querySelector(".machine-info-url")?.textContent).toBe(document.location.host);
    expect(switcher.shadowRoot?.querySelector(".machine-switcher-button")).toBeNull();
    expect(await switcher.focusSelectedOrFirst()).toBe(false);
  });

  it("uses each machine deployment icon and the local gateway URL in the picker", async () => {
    const remote = { ...machine("remote-a", "remote"), baseUrl: "https://fleet-a.example.com/pi-web/" };
    const switcher = await mountSwitcher([machine("local", "local"), remote], new Set());

    switcherButton(switcher).click();
    await switcher.updateComplete;

    const options = [...(switcher.shadowRoot?.querySelectorAll(".machine-option") ?? [])];
    expect(options[0]?.querySelector("small")?.textContent).toContain(document.location.host);
    expect(options.map((option) => option.querySelector("img")?.getAttribute("src"))).toEqual([
      `${document.baseURI}favicon.svg`,
      "https://fleet-a.example.com/pi-web/favicon.svg",
    ]);
  });
});

async function mountSwitcher(machines: Machine[], unreadMachineIds: ReadonlySet<string>, locationIndicator = false): Promise<MachineSwitcher> {
  const switcher = new MachineSwitcher();
  switcher.machines = machines;
  const selected = machines[0];
  if (selected === undefined) throw new Error("Expected at least one machine");
  switcher.selected = selected;
  switcher.unreadMachineIds = unreadMachineIds;
  switcher.locationIndicator = locationIndicator;
  document.body.append(switcher);
  await switcher.updateComplete;
  return switcher;
}

function switcherButton(switcher: MachineSwitcher): HTMLElement {
  const button = switcher.shadowRoot?.querySelector(".machine-switcher-button");
  if (!(button instanceof HTMLElement)) throw new Error("Expected the machine switcher button");
  return button;
}

function optionFor(switcher: MachineSwitcher, machineName: string): Element {
  const options = [...(switcher.shadowRoot?.querySelectorAll(".machine-option") ?? [])];
  const option = options.find((candidate) => candidate.textContent.includes(machineName));
  if (option === undefined) throw new Error(`Expected a machine option for ${machineName}`);
  return option;
}

function unreadDot(option: Element): Element | null {
  return option.querySelector(".activity-indicator.unread");
}

function workspaceActivity(cwd: string, hasSessionActivity: boolean, hasTerminalActivity: boolean): WorkspaceActivity {
  return { cwd, hasSessionActivity, hasTerminalActivity, updatedAt: "2026-06-04T00:00:00.000Z" };
}

function machine(id: string, kind: Machine["kind"]): Machine {
  return {
    id,
    name: id,
    kind,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}

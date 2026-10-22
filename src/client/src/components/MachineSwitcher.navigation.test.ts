// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setClientTranslations } from "../i18n";
beforeEach(() => { setClientTranslations("en", {}); });
import type { Machine, MachineHealth, MachineStatus } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { machineStatusSnapshot } from "../machineStatus.testSupport";
import { installPopoverFake } from "./anchoredPopup.testSupport";
installPopoverFake();
import { MachineSwitcher } from "./MachineSwitcher";

afterEach(() => {
  document.body.replaceChildren();
});

describe("machine-switcher status indicator", () => {
  it("aggregates old-daemon activity and unread while suppressing offline work", async () => {
    const switcher = await mountSwitcher([machine("local", "local"), machine("legacy", "remote")], {});
    switcher.activities = { legacy: { "/repo": { cwd: "/repo", hasSessionActivity: true, hasTerminalActivity: false, updatedAt: "now" } } };
    switcher.unreadMachineIds = new Set(["legacy"]);
    await switcher.updateComplete;
    expect(switcherButton(switcher).querySelector(".other-machines-activity .unread-ring .session")).not.toBeNull();
    switcher.statuses = { legacy: { ...health("offline"), machineId: "legacy" } };
    await switcher.updateComplete;
    expect(switcherButton(switcher).querySelector(".other-machines-activity .session")).toBeNull();
    expect(switcherButton(switcher).querySelector(".other-machines-activity .unread")).not.toBeNull();
    switcher.statusSnapshots = { legacy: machineStatusSnapshot() };
    await switcher.updateComplete;
    expect(switcherButton(switcher).querySelector(".other-machines-activity")).toBeNull();
  });

  it("keeps the full machine name and current status available without the visible labels", async () => {
    const remote = { ...machine("remote-a", "remote"), name: "Production build machine in the office", baseUrl: "https://fleet-a.example.com/" };
    const switcher = await mountSwitcher([remote, machine("local", "local")], {}, { "remote-a": { ...health("offline"), machineId: "remote-a" } });
    const button = switcherButton(switcher);

    expect(button.getAttribute("aria-label")).toBe(`Machine: ${remote.name}. Offline. Switch machine.`);
    expect(button.title).toBe(`${remote.name} · ${remote.baseUrl} · Offline`);
    expect(button.classList.contains("disconnected")).toBe(true);
    expect(button.querySelector(".machine-status")).toBeNull();
    expect(button.querySelector(".machine-icon")?.classList.contains("dimmed")).toBe(true);

    switcher.statuses = { "remote-a": { ...health("online"), machineId: "remote-a" } };
    await switcher.updateComplete;
    expect(button.getAttribute("aria-label")).toContain("Online");
    expect(button.classList.contains("disconnected")).toBe(false);
    expect(button.querySelector(".machine-status")).toBeNull();
    expect(button.querySelector(".machine-icon")?.classList.contains("dimmed")).toBe(false);

    button.click();
    await switcher.updateComplete;
    const option = optionFor(switcher, remote.name);
    expect(option.querySelector(".machine-option-name")?.textContent).toContain(remote.name);
    expect(option.querySelector("small")?.textContent).toContain("Online");
  });

  it("does not repeat the selected machine's attention in the other-machines indicator", async () => {
    const switcher = await mountSwitcher([machine("local", "local"), machine("remote-a", "remote")], {
      local: machineStatusSnapshot({ machine: { "core:working": true, "core:unread": true } }),
    });

    expect(switcherButton(switcher).querySelector(".unread-ring")).not.toBeNull();
    expect(switcherButton(switcher).querySelector(".other-machines-activity")).toBeNull();
  });

  it("combines work and unread from unselected machines and updates when selection changes", async () => {
    const remoteA = machine("remote-a", "remote");
    const remoteB = machine("remote-b", "remote");
    const switcher = await mountSwitcher([machine("local", "local"), remoteA, remoteB], {
      "remote-a": machineStatusSnapshot({ machine: { "core:terminal": true, "core:unread": true } }),
      "remote-b": machineStatusSnapshot({ machine: { "core:working": true } }),
    });
    const otherIndicator = () => switcherButton(switcher).querySelector(".other-machines-activity");

    expect(otherIndicator()?.querySelector(".unread-ring")?.getAttribute("title")).toBe("Unread sessions on other machines · Other machines active");
    expect(otherIndicator()?.querySelector(".activity-indicator.session")).not.toBeNull();

    switcher.selected = remoteA;
    await switcher.updateComplete;
    expect(otherIndicator()?.querySelector(".unread-ring")).toBeNull();
    expect(otherIndicator()?.querySelector(".activity-indicator.session")).not.toBeNull();

    switcher.selected = remoteB;
    await switcher.updateComplete;
    expect(otherIndicator()?.querySelector(".activity-indicator.terminal")).not.toBeNull();
    expect(otherIndicator()?.querySelector(".unread-ring")?.getAttribute("title")).toBe("Unread sessions on other machines · Terminal active on other machines");
  });

  it.each(["offline", "error"] as const)("keeps unread but ignores stale work from %s unselected machines", async (status) => {
    const switcher = await mountSwitcher([machine("local", "local"), machine("remote-a", "remote")], {
      "remote-a": machineStatusSnapshot({ machine: { "core:working": true, "core:unread": true } }),
    }, { "remote-a": { ...health(status), machineId: "remote-a" } });
    const indicator = switcherButton(switcher).querySelector(".other-machines-activity");

    expect(indicator?.querySelector(".activity-indicator.session")).toBeNull();
    expect(indicator?.querySelector(".activity-indicator.unread")?.getAttribute("title")).toBe("Unread sessions on other machines");

    switcher.statusSnapshots = { "remote-a": machineStatusSnapshot({ machine: { "core:working": true } }) };
    await switcher.updateComplete;
    expect(switcherButton(switcher).querySelector(".other-machines-activity")).toBeNull();
  });

});
async function mountSwitcher(machines: Machine[], statusSnapshots: Record<string, MachineStatusSnapshot>, statuses: Record<string, MachineHealth> = {}, locationIndicator = false): Promise<MachineSwitcher> {
  const switcher = new MachineSwitcher();
  switcher.machines = machines;
  const selected = machines[0];
  if (selected === undefined) throw new Error("Expected at least one machine");
  switcher.selected = selected;
  switcher.statusSnapshots = statusSnapshots;
  switcher.statuses = statuses;
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



function health(status: MachineStatus): MachineHealth {
  return { machineId: "local", ok: status === "online", checkedAt: "2026-06-04T00:00:00.000Z", status };
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

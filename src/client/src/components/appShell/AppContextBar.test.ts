// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { Machine } from "../../api";
import { AppContextBar, machineContextDetail } from "./AppContextBar";

afterEach(() => {
  document.body.replaceChildren();
});

it("omits folder workspace selection while preserving project and session selection", async () => {
  const selected: string[] = [];
  const bar = new AppContextBar();
  bar.workspaceSelectionVisible = false;
  bar.onOpenSection = (section) => { selected.push(section); };
  document.body.append(bar);
  await bar.updateComplete;
  const buttons = bar.shadowRoot?.querySelectorAll<HTMLButtonElement>(".context-items button");
  expect(buttons).toHaveLength(2);
  buttons?.forEach((button) => { button.click(); });
  expect(selected).toEqual(["projects", "sessions"]);
  bar.workspaceSelectionVisible = true;
  await bar.updateComplete;
  expect(bar.shadowRoot?.querySelectorAll(".context-items button")).toHaveLength(3);
});

describe("machineContextDetail", () => {
  it("uses the serving gateway for local machines and the remote host otherwise", () => {
    const remote = { ...machine("remote-a"), baseUrl: "https://fleet-a.example.com/pi-web/" };
    expect(machineContextDetail(machine("local"), "pi-dev.example.com")).toBe("pi-dev.example.com");
    expect(machineContextDetail(remote, "pi-dev.example.com")).toBe("fleet-a.example.com");
  });

  it("omits invalid remote URLs", () => {
    expect(machineContextDetail({ ...machine("remote-a"), baseUrl: "not a url" }, "pi-dev.example.com")).toBeUndefined();
  });
});

describe("machine crumb", () => {
  it("hides a single machine in browser mode", async () => {
    expect(machineChip(await mountBar([machine("local")]))).toBeUndefined();
  });

  it("shows a static gateway identity for a single machine in PWA mode", async () => {
    const chip = machineChip(await mountBar([machine("local")], true));
    expect(chip?.tagName).toBe("SPAN");
    expect(chip?.querySelector("img")?.getAttribute("src")).toContain("favicon.svg");
    expect(chip?.textContent).toContain(document.location.host);
    expect(chip?.textContent).not.toContain("本地");
  });

  it("keeps the browser-mode multi-machine chip as a plain picker", async () => {
    const bar = await mountBar([machine("local"), machine("remote-a")]);
    const opened: string[] = [];
    bar.onOpenSection = (section) => { opened.push(section); };
    const chip = machineChip(bar);
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.textContent).toContain("本地");
    expect(chip?.querySelector("img")).toBeNull();
    expect(chip?.textContent).not.toContain(document.location.host);
    chip?.click();
    expect(opened).toEqual(["machines"]);
  });

  it("keeps local location identity on the multi-machine picker in PWA mode", async () => {
    const chip = machineChip(await mountBar([machine("local"), machine("remote-a")], true));
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.textContent).toContain("本地");
    expect(chip?.querySelector("img")).not.toBeNull();
    expect(chip?.textContent).toContain(document.location.host);
  });

  it("shows selected remote location identity in PWA mode", async () => {
    const remote = { ...machine("remote-a"), baseUrl: "https://fleet-a.example.com/" };
    const bar = await mountBar([machine("local"), remote], true, remote);
    expect(machineChip(bar)?.textContent).toContain("fleet-a.example.com");
  });
});

describe("navigation button", () => {
  it("marks a hidden active destination as current", async () => {
    const bar = new AppContextBar();
    bar.onShowNavigation = () => undefined;
    bar.hiddenActiveDestination = true;
    document.body.append(bar);
    await bar.updateComplete;

    const button = bar.renderRoot.querySelector<HTMLButtonElement>(".context-action-button");
    expect(button?.classList.contains("selected")).toBe(true);
    expect(button?.getAttribute("aria-pressed")).toBe("true");
  });
});

async function mountBar(machines: Machine[], locationIndicator = false, selected?: Machine): Promise<AppContextBar> {
  const bar = new AppContextBar();
  bar.machines = machines;
  bar.locationIndicator = locationIndicator;
  if (selected !== undefined) bar.machine = selected;
  document.body.append(bar);
  await bar.updateComplete;
  return bar;
}

function machineChip(bar: AppContextBar): HTMLElement | undefined {
  return bar.shadowRoot?.querySelector<HTMLElement>(".machine-chip") ?? undefined;
}

function machine(id: string): Machine {
  return {
    id,
    name: id === "local" ? "本地" : id,
    kind: id === "local" ? "local" : "remote",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}

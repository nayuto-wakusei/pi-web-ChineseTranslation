// @vitest-environment happy-dom

import { html, render, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebComponentStatus, PiWebStatusResponse, PluginRuntimeState, TerminalCommandRun, TerminalCommandRunHandle, ApplicationPanelContext, WorkspacePanelTerminal } from "@chainingintention/pi-web-cn/plugin-api";
import plugin from "./pi-web-plugin.js";

function component(overrides: Partial<PiWebComponentStatus> = {}): PiWebComponentStatus {
  return {
    component: "web",
    label: "Web/UI",
    runtimeVersion: "1.202605.8",
    installedVersion: "1.202605.8",
    stale: false,
    available: true,
    ...overrides,
  };
}

function status(overrides: Partial<PiWebStatusResponse> = {}): PiWebStatusResponse {
  return {
    packageName: "@chainingintention/pi-web-cn",
    generatedAt: "2026-06-14T00:00:00.000Z",
    components: {
      web: component({ component: "web", label: "Web/UI" }),
      sessiond: component({ component: "sessiond", label: "Session daemon" }),
    },
    release: { packageName: "@chainingintention/pi-web-cn", updateAvailable: false },
    commands: {},
    messages: [],
    ...overrides,
  };
}

function commandRunHandle(input: { title: string; command: string }): TerminalCommandRunHandle {
  const run: TerminalCommandRun = {
    id: "run-1",
    origin: "updates",
    projectId: "project-1",
    workspaceId: "workspace-1",
    terminalId: "terminal-1",
    title: input.title,
    command: input.command,
    status: "running",
    createdAt: "2026-06-14T00:00:00.000Z",
    metadata: {},
  };
  return { run, completed: Promise.resolve({ ...run, status: "succeeded" }) };
}

function panelContext(state: PluginRuntimeState, terminal?: WorkspacePanelTerminal): ApplicationPanelContext {
  const noop = () => undefined;
  return {
    navigate: () => Promise.resolve(),
    machine: { id: "local", name: "local", kind: "local" },
    state,
    host: { requestRender: noop },
    prompt: { insertText: noop, getText: () => "", getSelection: () => null },
    ...(terminal === undefined ? {} : {
      workspace: { id: "workspace-1", projectId: "project-1", path: "/repo", label: "main", isMain: true },
      terminal,
    }),
  };
}

function renderPanel(value: PiWebStatusResponse, terminal?: WorkspacePanelTerminal): HTMLElement {
  const contributions = plugin.activate({
    apiVersion: 4,
    pluginId: "updates",
    runtimePluginId: "updates",
    html,
    svg,
    signal: new AbortController().signal,
    lifetimeSignal: new AbortController().signal,
  }).contributions;
  const panel = contributions.applicationPanels[0];
  if (panel === undefined) throw new Error("Expected Updates application panel");
  const container = document.createElement("div");
  document.body.append(container);
  render(panel.render(panelContext({ piWebStatus: value }, terminal)), container);
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Updates plugin panel layout", () => {

  it("explains confirmation and safe-execution limits rather than promising a seamless update", () => {
    const container = renderPanel(status({
      release: { packageName: "@chainingintention/pi-web-cn", updateAvailable: true },
      commands: { update: "pi-web update" },
    }));
    expect(container.querySelector(".updates-recommended")?.textContent).toContain("Updates require confirmation in the terminal");
    expect(container.textContent).toContain("if this terminal cannot safely run the update");
    expect(container.textContent).not.toContain("Nothing else is required");
  });

  it("copies a command unchanged without requiring a selected workspace", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const command = "PI_CODING_AGENT_DIR='/profiles/active' '/usr/bin/node' '/opt/pi-web/dist/cli.js' update";
    const container = renderPanel(status({
      release: { packageName: "@chainingintention/pi-web-cn", updateAvailable: true },
      commands: { update: command },
    }));
    const copy = container.querySelector<HTMLButtonElement>(".updates-recommended button");
    expect(copy?.textContent).toBe("Copy");
    copy?.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(command);
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Run")).toBe(false);
  });

  it.each([
    "pi-web update",
    "PI_CODING_AGENT_DIR='/profiles/active' '/usr/bin/node' '/opt/pi-web/dist/cli.js' update",
  ])("runs the recommended command unchanged in the panel-scoped terminal: %s", (update) => {
    const runCommand = vi.fn<WorkspacePanelTerminal["runCommand"]>((input) => Promise.resolve(commandRunHandle(input)));
    const container = renderPanel(status({
      release: { packageName: "@chainingintention/pi-web-cn", updateAvailable: true, latestVersion: "1.202605.9" },
      commands: { update, restart: "pi-web-docker restart" },
      messages: [{
        id: "update-available",
        severity: "info",
        title: "PI WEB update available",
        body: "PI WEB 1.202605.9 is available. Run the update command to update PI WEB and restart its services.",
        command: update,
      }],
    }), { open: () => undefined, runCommand });

    const runButton = [...container.querySelectorAll<HTMLButtonElement>(".updates-recommended button")].find((button) => button.textContent === "Run");
    if (runButton === undefined) throw new Error("Expected a Run button in the recommended section");
    runButton.click();

    expect(runCommand).toHaveBeenCalledWith({
      title: "Update PI WEB",
      command: update,
      open: true,
      metadata: { "pi.plugin": "updates" },
    });
  });
});

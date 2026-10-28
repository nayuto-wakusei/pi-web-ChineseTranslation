/// <reference types="vite/client" />
// @vitest-environment happy-dom

import { translateChinese } from "../localization.testSupport.js";
import { html, render, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebComponentStatus, PiWebStatusResponse, PluginRuntimeState, MaintenanceTerminalCommandRun, TerminalCommandRunHandle, ApplicationPanelContext, MaintenanceTerminal, WorkspacePanelTerminal } from "@chainingintention/pi-web-cn/plugin-api";
import plugin from "./pi-web-plugin.js";
import { LocalizationService } from "../../src/client/src/localization/service.js";
import { createPluginLocalization } from "../../src/client/src/plugins/localization.js";

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

function commandRunHandle(input: { title: string; command: string }): TerminalCommandRunHandle<MaintenanceTerminalCommandRun> {
  const run: MaintenanceTerminalCommandRun = {
    id: "run-1",
    origin: "updates",
    scope: "maintenance",
    terminalId: "terminal-1",
    title: input.title,
    command: input.command,
    status: "running",
    createdAt: "2026-06-14T00:00:00.000Z",
    metadata: {},
  };
  return { run, completed: Promise.resolve({ ...run, status: "succeeded" }) };
}

function panelContext(state: PluginRuntimeState, terminal?: MaintenanceTerminal): ApplicationPanelContext {
  const noop = () => undefined;
  return {
    navigate: () => Promise.resolve(),
    machine: { id: "local", name: "local", kind: "local" },
    workspace: { id: "workspace-1", projectId: "project-1", path: "/repo", label: "main", isMain: true },
    state,
    host: { requestRender: noop },
    prompt: { insertText: noop, getText: () => "", getSelection: () => null },
    ...(terminal === undefined ? {} : {
      maintenanceTerminal: terminal,
    }),
  };
}

function renderPanel(value: PiWebStatusResponse, terminal?: MaintenanceTerminal, contextOverrides: Partial<ApplicationPanelContext> = {}, service?: LocalizationService): HTMLElement {
  const contributions = plugin.activate({
    localization: service === undefined ? createPluginLocalization(new LocalizationService(), "updates", "updates", new AbortController().signal) : createPluginLocalization(service, "updates", "updates", new AbortController().signal),
    apiVersion: 4,
    translate: translateChinese,
    pluginId: "updates",
    runtimePluginId: "updates",
    html,
    svg,
    signal: new AbortController().signal,
    lifetimeSignal: new AbortController().signal,
  }).contributions;
  const panel = contributions.applicationPanels[0];
  if (panel === undefined) throw new Error("Expected Updates workspace panel");
  const container = document.createElement("div");
  document.body.append(container);
  render(panel.render({ ...panelContext({ piWebStatus: value }, terminal), ...contextOverrides }), container);
  return container;
}

function sectionOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".viewer.updates-status > section")].map((section) => {
    if (section.classList.contains("updates-recommended")) return "recommended";
    if (section.classList.contains("updates-meta")) return "meta";
    const heading = section.querySelector(":scope > strong")?.textContent.trim();
    return heading === undefined || heading === "" ? "notices" : heading;
  });
}

function commandTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".updates-command code")].map((code) => code.textContent);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Updates plugin panel layout", () => {
  it("pseudo-localizes known gateway notices and controls without translating commands or versions", async () => {
    const service = new LocalizationService({ development: true, preferences: { language: "en-XA", formatLocale: "de-DE", timeZone: "UTC" } });
    await service.ready;
    const value = status({
      commands: { update: "pi-web update --flag" },
      release: { packageName: "@jmfederico/pi-web", updateAvailable: true, latestVersion: "9.8.7" },
      messages: [{ id: "update-available", severity: "info", title: "DO NOT RENDER SERVER TITLE", body: "DO NOT RENDER SERVER BODY" }],
    });
    const container = renderPanel(value, undefined, {}, service);
    expect(container.textContent).not.toContain("DO NOT RENDER");
    expect(container.querySelector(".updates-message-title strong")?.textContent).not.toBe("PI WEB update available");
    expect(container.querySelector(".updates-command button")?.textContent).not.toBe("Copy");
    expect(commandTexts(container)).toEqual(["pi-web update --flag"]);
    expect(container.textContent).toContain("9.8.7");
    expect(container.textContent).toContain("1.202605.8");
    expect(container.textContent).toContain(service.date(Date.parse(value.generatedAt), { dateStyle: "medium", timeStyle: "short" }));
  });

  it("describes a failed version check without declaring the daemon down or recommending a restart", () => {
    const value = status();
    value.components.sessiond = component({ component: "sessiond", available: false });
    value.commands = { restart: "pi-web restart" };
    value.messages = [{ id: "sessiond-unavailable", severity: "info", title: "old title", body: "old body" }];
    const panel = renderPanel(value);

    expect(panel.textContent).toContain("Session daemon version unknown");
    expect(panel.textContent).toContain("The last check could not determine the session daemon version.");
    expect(panel.textContent).toContain("If checks keep failing");
    expect(panel.querySelector(".updates-recommended")).toBeNull();
    expect(panel.querySelectorAll(".updates-version-row")[1]?.textContent).toContain("version unknown");
  });

  it("preserves unknown gateway notice details for forward compatibility", () => {
    const container = renderPanel(status({ messages: [{ id: "future", severity: "error", title: "Future gateway notice", body: "Keep this operational guidance" }] }));
    expect(container.textContent).toContain("Future gateway notice");
    expect(container.textContent).toContain("Keep this operational guidance");
  });
  it("folds the update notice into one recommended action above the services and optional commands", () => {
    const update = "npm install -g @chainingintention/pi-web-cn --allow-scripts=node-pty && pi-web restart";
    const container = renderPanel(status({
      release: { packageName: "@chainingintention/pi-web-cn", updateAvailable: true, latestVersion: "1.202605.9" },
      commands: {
        update,
        restart: "pi-web restart",
        restartWeb: "pi-web restart-web",
        restartSessiond: "pi-web restart-sessiond",
        status: "pi-web status",
      },
      messages: [{
        id: "update-available",
        severity: "info",
        title: "PI WEB update available",
        body: "PI WEB 1.202605.9 is available; installed version is 1.202605.8. Run the update command to update PI WEB and restart its services.",
        command: update,
      }],
    }));

    const recommended = container.querySelector(".updates-recommended");
    expect(recommended).not.toBeNull();
    expect(recommended?.textContent).toContain("PI WEB update available");
    // The notice keeps the user informed but offers no competing action of its own.
    expect(recommended?.querySelector(".updates-message button")).toBeNull();
    expect(recommended?.querySelector(".updates-message code")).toBeNull();
    expect([...container.querySelectorAll(".updates-message")].every((notice) => notice.closest(".updates-recommended") !== null)).toBe(true);
    // The update command appears exactly once in the whole panel.
    expect(commandTexts(container).filter((text) => text === update)).toHaveLength(1);
    expect(sectionOrder(container)).toEqual(["recommended", "Installed services", "Additional commands (optional)", "meta"]);
  });

  it("keeps notices action-free and defers their commands to the suggested list when nothing is recommended", () => {
    const restartWeb = "systemctl --user restart pi-web-web";
    const container = renderPanel(status({
      components: {
        web: component({ stale: true, installedVersion: "1.202605.9" }),
        sessiond: component({ component: "sessiond", label: "Session daemon" }),
      },
      commands: { restartWeb, status: "systemctl --user status pi-web-web" },
      messages: [{
        id: "web-stale",
        severity: "warning",
        title: "Web/UI service restart needed",
        body: "The Web/UI service is running 1.202605.8, but 1.202605.9 is installed. Restart the service to use the installed version.",
        command: restartWeb,
      }],
    }));

    expect(container.querySelector(".updates-recommended")).toBeNull();
    const notice = container.querySelector(".updates-message");
    expect(notice?.textContent).toContain("Web/UI service restart needed");
    expect(notice?.querySelector("button")).toBeNull();
    expect(notice?.querySelector("code")).toBeNull();
    // The notice's command still shows up exactly once, in the suggested list.
    expect(commandTexts(container).filter((text) => text === restartWeb)).toHaveLength(1);
    expect(sectionOrder(container)).toEqual(["notices", "Installed services", "Suggested commands", "meta"]);
  });

  it("shows the quiet state without a recommended action when everything is current", () => {
    const container = renderPanel(status({ commands: { restart: "pi-web restart" } }));

    expect(container.querySelector(".updates-recommended")).toBeNull();
    expect(container.textContent).toContain("No PI WEB update or restart messages.");
    expect(sectionOrder(container)).toEqual(["notices", "Installed services", "Suggested commands", "meta"]);
  });

  it("copies a command unchanged without requiring a selected workspace", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const command = "PI_CODING_AGENT_DIR='/profiles/active' '/usr/bin/node' '/opt/pi-web/dist/cli.js' update";
    const container = renderPanel(status({
      release: { packageName: "@jmfederico/pi-web", updateAvailable: true },
      commands: { update: command },
    }));
    const copy = container.querySelector<HTMLButtonElement>(".updates-recommended button");
    expect(copy?.textContent).toBe("Copy");
    copy?.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(command);
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Run")).toBe(false);
  });

  it("does not use the selected workspace terminal for maintenance commands", () => {
    const runCommand = vi.fn<MaintenanceTerminal["runCommand"]>((input) => Promise.resolve(commandRunHandle(input)));
    const workspaceRunCommand = vi.fn<WorkspacePanelTerminal["runCommand"]>();
    const container = renderPanel(status({ commands: { update: "pi-web update" } }), { open: () => undefined, runCommand }, {
      workspace: { id: "workspace-1", projectId: "project-1", path: "/repo", label: "main", isMain: true },
      terminal: { open: () => undefined, runCommand: workspaceRunCommand },
    });
    const run = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Run");
    expect(run).toBeDefined();
    run?.click();
    expect(runCommand).toHaveBeenCalledOnce();
    expect(workspaceRunCommand).not.toHaveBeenCalled();
  });

  it.each([
    "pi-web update",
    "PI_CODING_AGENT_DIR='/profiles/active' '/usr/bin/node' '/opt/pi-web/dist/cli.js' update",
  ])("runs the recommended command in the maintenance terminal without a workspace: %s", (update) => {
    const runCommand = vi.fn<MaintenanceTerminal["runCommand"]>((input) => Promise.resolve(commandRunHandle(input)));
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

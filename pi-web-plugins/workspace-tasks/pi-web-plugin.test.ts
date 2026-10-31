// @vitest-environment happy-dom

import type { PluginCapability, WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";
import { html, render, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "./pi-web-plugin.js";
import { LocalizationService } from "../../src/client/src/localization/service.js";
import { createPluginLocalization } from "../../src/client/src/plugins/localization.js";
import { createTasksLocalization } from "./tasksLocalization.js";
import { defineTasksPanelElement, PiWebTasksPanel, tasksPanelTagName } from "./tasksPanelElement.js";

let workspaceSequence = 0;
const lifetimes: AbortController[] = [];

function localizationFixture(development = false) {
  const service = new LocalizationService({ development, preferences: { language: "en", formatLocale: "de-DE" } });
  const lifetime = new AbortController();
  lifetimes.push(lifetime);
  const localization = createPluginLocalization(service, "workspace-tasks", "remote.workspace-tasks", lifetime.signal);
  return { service, lifetime, localization };
}

afterEach(() => {
  document.body.replaceChildren();
  for (const lifetime of lifetimes.splice(0)) lifetime.abort();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected panel element or contribution");
  return value;
}

function activate(localization = localizationFixture().localization) {
  return plugin.activate({
    apiVersion: 4, pluginId: "workspace-tasks", runtimePluginId: "remote.workspace-tasks",
    html, svg, localization, signal: new AbortController().signal, lifetimeSignal: new AbortController().signal,
  });
}

function workspaceContext() {
  return {
    navigate: vi.fn(),
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: `workspace-${String(++workspaceSequence)}`, projectId: "project", path: "/repo", label: "main", isMain: true },
    files: {
      capabilityVersion: 1, defaultUploadFolder: ".pi-web/uploads", maxInlinePreviewBytes: 1024,
      readFile: vi.fn().mockResolvedValue({
        content: JSON.stringify({ version: 1, tasks: [{ id: "build", title: "Build <app>", command: "npm run build", confirm: true }] }),
        truncated: false, binary: false,
      }),
      listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn(),
      previewUrl: vi.fn(), downloadUrl: vi.fn(), uploadFile: vi.fn(),
    },
    host: { requestRender: vi.fn() },
    prompt: { insertText: vi.fn(), getText: vi.fn(() => ""), getSelection: vi.fn(() => null) },
    terminal: { open: vi.fn(), runCommand: vi.fn<WorkspacePanelContext["terminal"]["runCommand"]>() },
    navigation: { version: 1, contributionId: "remote.workspace-tasks:workspace.tasks", query: {}, set: vi.fn() },
  } satisfies WorkspacePanelContext;
}

function createPanel(translations = createTasksLocalization(localizationFixture().localization)): PiWebTasksPanel {
  defineTasksPanelElement();
  const panel = document.createElement(tasksPanelTagName);
  if (!(panel instanceof PiWebTasksPanel)) throw new Error("Expected Tasks panel");
  panel.translations = translations;
  return panel;
}

function root(panel: Element): ShadowRoot {
  return required(panel.shadowRoot);
}

function button(panel: Element, selector: string): HTMLButtonElement {
  return required(root(panel).querySelector<HTMLButtonElement>(selector));
}

describe("Workspace Tasks localization", () => {
  it("keeps metadata, confirmation, status, and child controls live without translating user content", async () => {
    const { service, localization } = localizationFixture(true);
    const instance = activate(localization);
    const contribution = required(instance.contributions.workspacePanels[0]);
    const action = required(instance.contributions.actions[0]);
    const context = workspaceContext();
    const container = document.createElement("div");
    document.body.append(container);
    render(contribution.render(context), container);
    const panel = required(container.querySelector(tasksPanelTagName));
    await vi.waitFor(() => { expect(button(panel, "[data-task-id]").textContent).toBe("Run"); });
    service.registerCatalog({ id: "tasks-fr", namespace: "plugin:workspace-tasks:tasks", locale: "fr", load: () => Promise.resolve({
      tasks: "Tâches", openTasks: "Ouvrir les tâches", workspace: "Espace", openDescription: "Configurer {path}.",
      refresh: "Actualiser", run: "Exécuter", cancelled: "Annulé : {title}.",
      confirm: "Exécuter {title} ?\n\n{command}", loaded: "{count, plural, one {# tâche chargée} other {# tâches chargées}}.",
    }) });
    await service.setPreferences({ ...service.preferences, language: "fr" });
    expect(contribution.title).toBe("Tâches");
    expect(action.title).toBe("Ouvrir les tâches");
    expect(action.group).toBe("Espace");
    expect(action.description).toBe("Configurer .pi-web/tasks.json.");
    expect(button(panel, "[data-refresh-config]").textContent).toBe("Actualiser");
    expect(button(panel, "[data-task-id]").textContent).toBe("Exécuter");
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    button(panel, "[data-task-id]").click();
    expect(confirm).toHaveBeenCalledWith("Exécuter Build <app> ?\n\nnpm run build");
    expect(root(panel).textContent).toContain("Annulé : Build <app>.");
    await service.setPreferences({ ...service.preferences, language: "en" });
    expect(root(panel).textContent).toContain("Cancelled Build <app>.");
    button(panel, "[data-refresh-config]").click();
    await vi.waitFor(() => { expect(root(panel).textContent).toContain("Loaded 1 task."); });
    await service.setPreferences({ ...service.preferences, language: "fr" });
    expect(root(panel).textContent).toContain("1 tâche chargée.");
    for (const language of ["en-XA", "ar-XB"]) {
      await service.setPreferences({ ...service.preferences, language });
      expect(button(panel, "[data-task-id]").textContent).not.toBe("Run");
      expect(root(panel).textContent).toContain("Build <app>");
      expect(root(panel).textContent).toContain("npm run build");
      expect(root(panel).textContent).toContain(".pi-web/tasks.json");
      expect(root(panel).querySelector("app")).toBeNull();
    }
    expect(service.direction).toBe("rtl");
  });

  it("retranslates cached frontend diagnostics and preserves backend failure text", async () => {
    const { service, localization } = localizationFixture();
    const translations = createTasksLocalization(localization);
    const panel = createPanel(translations);
    const context = workspaceContext();
    context.files.readFile.mockResolvedValue({ content: JSON.stringify({ version: 1, tasks: [{ id: "bad id" }] }), truncated: false, binary: false });
    panel.context = context;
    document.body.append(panel);
    await vi.waitFor(() => { expect(root(panel).textContent).toContain("Task 1 id must match ^[a-z][a-z0-9.-]*$"); });
    service.registerCatalog({ id: "issues-fr", namespace: "plugin:workspace-tasks:tasks", locale: "fr", load: () => Promise.resolve({
      unavailable: "Chargement impossible.", taskId: "Identifiant {index, number} : {pattern}",
      readError: "Lecture de {path} impossible : {error}",
    }) });
    await service.setPreferences({ ...service.preferences, language: "fr" });
    expect(root(panel).textContent).toContain("Chargement impossible.");
    expect(root(panel).textContent).toContain("Identifiant 1 : ^[a-z][a-z0-9.-]*$");
    expect(context.files.readFile).toHaveBeenCalledOnce();
    context.files.readFile.mockRejectedValue(new Error("<img src=x> backend failure"));
    button(panel, "[data-refresh-config]").click();
    await vi.waitFor(() => { expect(root(panel).textContent).toContain("Lecture de .pi-web/tasks.json impossible : <img src=x> backend failure"); });
    expect(root(panel).querySelector("img")).toBeNull();
  });

  it("cleans up, replaces and reconnects child localization subscriptions", async () => {
    const first = localizationFixture();
    const panel = createPanel(createTasksLocalization(first.localization));
    const context = workspaceContext();
    panel.context = context;
    document.body.append(panel);
    await vi.waitFor(() => { expect(button(panel, "[data-task-id]").textContent).toBe("Run"); });
    // Observe cleanup through behavior: detached DOM must not re-render on locale changes.
    panel.remove();
    const detachedButton = button(panel, "[data-task-id]");
    first.service.registerCatalog({ id: "first-fr", namespace: "plugin:workspace-tasks:tasks", locale: "fr", load: () => Promise.resolve({ run: "Premier" }) });
    await first.service.setPreferences({ language: "fr", formatLocale: "de-DE" });
    expect(button(panel, "[data-task-id]")).toBe(detachedButton);
    expect(detachedButton.textContent).toBe("Run");
    document.body.append(panel);
    expect(button(panel, "[data-task-id]").textContent).toBe("Premier");
    const second = localizationFixture();
    panel.translations = createTasksLocalization(second.localization);
    await second.service.ready;
    const replacementButton = button(panel, "[data-task-id]");
    await first.service.setPreferences({ language: "en", formatLocale: "en" });
    expect(button(panel, "[data-task-id]")).toBe(replacementButton);
  });
});

describe("Workspace Tasks stylesheet integration", () => {
  it("requires v1 and registers the rendered panel for shared UI with activation-local ownership", () => {
    const requirement = required(plugin.requires.find(({ id }) => id === "stylesheet-integration"));
    expect(plugin.requires).toEqual([requirement]);
    expect(requirement).toMatchObject({ pluginId: "pi-web", id: "stylesheet-integration", version: 1 });
    const release = vi.fn();
    const integration = { registerRoot: vi.fn(() => release), createController: vi.fn(), subscribe: vi.fn(() => vi.fn()) };
    for (const value of [null, undefined, {}, { ...integration, registerRoot: undefined }, { ...integration, createController: undefined }, { ...integration, subscribe: undefined }]) {
      expect(() => requirement.parse(value)).toThrow("Stylesheet integration capability v1");
    }
    const instance = activate();
    const requests = vi.fn();
    instance.start({ signal: new AbortController().signal, capabilities: {
      resolve<Value>(token: PluginCapability<Value>): Value {
        requests(token);
        return token.parse(integration);
      },
    } });
    expect(requests).toHaveBeenCalledExactlyOnceWith(requirement);
    const container = document.createElement("div");
    document.body.append(container);
    render(required(instance.contributions.workspacePanels[0]).render(workspaceContext()), container);
    const panel = required(container.querySelector(tasksPanelTagName));
    expect(integration.registerRoot).toHaveBeenCalledExactlyOnceWith(root(panel), { sharedUi: true });
    // Another activation must not inherit the first instance's integration.
    render(required(activate().contributions.workspacePanels[0]).render(workspaceContext()), container);
    expect(release).toHaveBeenCalledOnce();
    expect(integration.registerRoot).toHaveBeenCalledOnce();
  });

  it("releases and replaces root registrations without rebuilding content or listeners", async () => {
    const panel = createPanel();
    const release = vi.fn();
    const integration = { registerRoot: vi.fn(() => release), createController: vi.fn(), subscribe: vi.fn(() => vi.fn()) };
    panel.stylesheetIntegration = integration;
    expect(integration.registerRoot).not.toHaveBeenCalled();
    const context = workspaceContext();
    panel.context = context;
    document.body.append(panel);
    expect(integration.registerRoot).toHaveBeenCalledExactlyOnceWith(root(panel), { sharedUi: true });
    await vi.waitFor(() => { expect(button(panel, "[data-task-id]").textContent).toBe("Run"); });
    const open = button(panel, "[data-open-terminal]");
    const viewer = required(root(panel).querySelector(".viewer"));
    panel.stylesheetIntegration = integration;
    expect(integration.registerRoot).toHaveBeenCalledOnce();
    const releaseReplacement = vi.fn();
    const replacement = { ...integration, registerRoot: vi.fn(() => releaseReplacement) };
    panel.stylesheetIntegration = replacement;
    expect(release).toHaveBeenCalledOnce();
    expect(replacement.registerRoot).toHaveBeenCalledExactlyOnceWith(root(panel), { sharedUi: true });
    expect(button(panel, "[data-open-terminal]")).toBe(open);
    expect(root(panel).querySelector(".viewer")).toBe(viewer);
    open.click();
    expect(context.terminal.open).toHaveBeenCalledOnce();
    panel.remove();
    expect(releaseReplacement).toHaveBeenCalledOnce();
    document.body.append(panel);
    expect(replacement.registerRoot).toHaveBeenCalledTimes(2);
    expect(replacement.registerRoot).toHaveBeenLastCalledWith(root(panel), { sharedUi: true });
  });

  it("preserves refresh, confirmation, dispatch disabling, and terminal events on native UI controls", async () => {
    const context = workspaceContext();
    let rejectRun: (reason: Error) => void = () => { throw new Error("No task dispatched"); };
    context.terminal.runCommand.mockImplementation(() => new Promise((_resolve, reject) => { rejectRun = reject; }));
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const panel = createPanel();
    panel.context = context;
    document.body.append(panel);
    expect(button(panel, "[data-refresh-config]").disabled).toBe(true);
    await vi.waitFor(() => { expect(button(panel, "[data-refresh-config]").disabled).toBe(false); });
    expect(root(panel).textContent).toContain("Build <app>");
    expect(root(panel).querySelector("app")).toBeNull();
    button(panel, "[data-task-id]").click();
    expect(confirm).toHaveBeenCalledWith("Run Build <app>?\n\nnpm run build");
    expect(context.terminal.runCommand).not.toHaveBeenCalled();
    expect(root(panel).textContent).toContain("Cancelled Build <app>.");
    confirm.mockReturnValue(true);
    button(panel, "[data-task-id]").click();
    expect(button(panel, "[data-task-id]").disabled).toBe(true);
    expect(button(panel, "[data-task-id]").textContent).toBe("Dispatching…");
    expect(context.terminal.runCommand).toHaveBeenCalledExactlyOnceWith({
      title: "Build <app>", command: "npm run build", open: true,
      metadata: { "pi.plugin": "workspace-tasks", "task.id": "build" },
    });
    rejectRun(new Error("Dispatch failed"));
    await vi.waitFor(() => { expect(button(panel, "[data-task-id]").disabled).toBe(false); });
  });
});

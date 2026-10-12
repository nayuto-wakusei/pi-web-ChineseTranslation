// @vitest-environment happy-dom
import { html, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { machineScopedBundledPluginId } from "../../../shared/machinePluginIds";
import { loadNavigationPreferences, saveNavigationPreferences, type NavigationPreferences } from "../navigationPreferences";
import { PluginRegistry } from "../plugins/registry";
import type { PiWebPluginRegistration, QualifiedContributionId } from "../plugins/types";
import { PiWebApp } from "./PiWebApp";
import { WorkspacePanel } from "./WorkspacePanel";
import { NavigationDialog } from "./appShell/NavigationDialog";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

function call(app: PiWebApp, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`Missing ${name}`);
  return Reflect.apply(method, app, args);
}

function preferences(app: PiWebApp): NavigationPreferences {
  const value = call(app, "resolvedNavigationPreferences");
  if (typeof value !== "object" || value === null || !("pinnedIds" in value) || !Array.isArray(value.pinnedIds) || !("mobileCollapsed" in value) || typeof value.mobileCollapsed !== "boolean") throw new Error("Invalid navigation preferences");
  const pinnedIds = value.pinnedIds.filter((id: unknown): id is string => typeof id === "string");
  if (pinnedIds.length !== value.pinnedIds.length) throw new Error("Invalid pinned id");
  return { pinnedIds, mobileCollapsed: value.mobileCollapsed };
}

function panelRegistration(kind: "files" | "git" | "terminal", machineId = "local"): PiWebPluginRegistration {
  const sourcePluginId = `pi-web.${kind}`;
  return {
    id: machineId === "local" ? sourcePluginId : machineScopedBundledPluginId(machineId, sourcePluginId),
    sourcePluginId,
    machineSpecific: true,
    ...(machineId === "local" ? {} : { machineId }),
    plugin: {
      apiVersion: 4,
      name: kind,
      activate: () => ({ contributions: { workspacePanels: [{
        id: `workspace.${kind}`, title: kind === "files" ? "文件" : kind === "git" ? "Git" : "终端",
        routeAliases: [kind, `core:workspace.${kind}`],
        navigationAliases: [`core:workspace.${kind}`],
        render: () => html`<p>${kind}</p>`,
      }] } }),
    },
  };
}

function createApp(machineId: string): { app: PiWebApp; registry: PluginRegistry } {
  const query = new URLSearchParams({ project: "project", workspace: "workspace", view: "workspace" });
  if (machineId !== "local") query.set("machine", machineId);
  window.history.replaceState({}, "", `/?${query}`);
  const app = new PiWebApp();
  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  Reflect.set(app, "verifiedPluginModeByMachine", new Map([[machineId, "recovery-disabled"]]));
  const workspace = { id: "workspace", projectId: "project", path: "/repo", label: "main", isMain: true, effectiveConfig: {} };
  Reflect.set(app, "state", {
    ...initialAppState(), projects: [{ id: "project", name: "项目", path: "/repo", createdAt: "now" }],
    selectedProject: { id: "project", name: "项目", path: "/repo", createdAt: "now" },
    selectedWorkspace: workspace, workspaces: [workspace], mainView: "workspace",
    ...(machineId === "local" ? {} : { selectedMachine: { id: machineId, name: machineId, kind: "remote", createdAt: "now", updatedAt: "now" } }),
  });
  const registry: unknown = Reflect.get(app, "plugins");
  if (!(registry instanceof PluginRegistry)) throw new Error("Missing plugin registry");
  return { app, registry };
}

describe("legacy navigation preference consumption", () => {
  it.each(["local", "remote"])("projects late-loaded aliases only for the selected %s machine and unpins without rewriting unrelated aliases", async (machineId) => {
    const raw = { pinnedIds: ["core:workspace.files", "core:workspace.git", "missing:panel"], mobileCollapsed: false };
    saveNavigationPreferences(raw);
    const { app, registry } = createApp(machineId);
    expect(preferences(app)).toEqual(raw);
    await registry.register(panelRegistration("files"));
    await registry.register(panelRegistration("git"));
    if (machineId !== "local") {
      expect(preferences(app)).toEqual(raw);
      await registry.register(panelRegistration("files", machineId));
      await registry.register(panelRegistration("git", machineId));
    }
    const runtime = (kind: "files" | "git"): QualifiedContributionId => {
      const id = machineId === "local" ? `pi-web.${kind}` : machineScopedBundledPluginId(machineId, `pi-web.${kind}`);
      return `${id}:workspace.${kind}`;
    };
    expect(preferences(app).pinnedIds).toEqual([runtime("files"), runtime("git"), "missing:panel"]);
    expect(loadNavigationPreferences()).toEqual(raw);

    Reflect.set(app, "navigationDialogOpen", true);
    const host = document.createElement("div");
    document.body.append(host);
    render(app.render(), host);
    const panel = host.querySelector("workspace-panel");
    const dialog = host.querySelector("navigation-dialog");
    if (!(panel instanceof WorkspacePanel) || !(dialog instanceof NavigationDialog)) throw new Error("Missing navigation surfaces");
    await panel.updateComplete;
    await dialog.updateComplete;
    expect(panel.pinnedIds).toEqual([runtime("files"), runtime("git"), "missing:panel"]);
    const unpin = dialog.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="取消固定：文件"]');
    if (unpin == null) throw new Error("Missing aliased Files pin");
    unpin.click();
    expect(loadNavigationPreferences()).toEqual({ pinnedIds: ["core:workspace.git", "missing:panel"], mobileCollapsed: false });
    expect(preferences(app).pinnedIds).toEqual([runtime("git"), "missing:panel"]);

    call(app, "changeNavigationPreferences", { ...preferences(app), mobileCollapsed: true });
    expect(loadNavigationPreferences()).toEqual({ pinnedIds: ["core:workspace.git", "missing:panel"], mobileCollapsed: true });
    call(app, "changeNavigationPreferences", { pinnedIds: [], mobileCollapsed: true });
    expect(loadNavigationPreferences()).toEqual({ pinnedIds: [], mobileCollapsed: true });
  });
});
